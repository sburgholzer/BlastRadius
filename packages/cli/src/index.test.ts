import { describe, it, expect, vi } from 'vitest';
import {
  parseArgs,
  main,
  handleAnalyze,
  handleStatus,
  handleExport,
  formatVerdict,
  formatError,
} from './index';
import type { ApiClient, AnalyzeOptions } from './index';
import type { AnalysisResult, AnalysisStatus } from '@blast-radius/core';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockAnalysisResult(
  overrides?: Partial<AnalysisResult>
): AnalysisResult {
  return {
    analysisId: 'test-analysis-123',
    status: 'completed',
    requestingPrincipal: 'arn:aws:iam::123456789012:user/test',
    originatingAccountId: '123456789012',
    sourceFormat: 'canonical',
    submittedAt: '2024-01-15T10:30:00Z',
    completedAt: '2024-01-15T10:31:00Z',
    manifest: {
      version: '1.0',
      metadata: {
        submittedAt: '2024-01-15T10:30:00Z',
        sourceFormat: 'canonical',
      },
      resources: [],
    },
    dependencyGraph: { nodes: [], edges: [] },
    scoredResources: [],
    riskSummary: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      totalAffected: 0,
      highestScore: 0,
    },
    stageDurations: {},
    completedStages: ['Ingestion', 'Discovery', 'Scoring'],
    ...overrides,
  };
}

function createMockStatus(
  overrides?: Partial<AnalysisStatus>
): AnalysisStatus {
  return {
    analysisId: 'test-analysis-123',
    requestingPrincipal: 'arn:aws:iam::123456789012:user/test',
    originatingAccountId: '123456789012',
    status: 'running',
    currentStage: 'Discovery',
    progressPercentage: 50,
    elapsedTimeMs: 5000,
    startedAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T10:30:05Z',
    ...overrides,
  };
}

function createMockApiClient(overrides?: Partial<ApiClient>): ApiClient {
  return {
    submitAnalysis: vi.fn().mockResolvedValue(createMockAnalysisResult()),
    getStatus: vi.fn().mockResolvedValue(createMockStatus()),
    getExport: vi.fn().mockResolvedValue(createMockAnalysisResult()),
    ...overrides,
  };
}

// ─── parseArgs Tests ─────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses command with no flags', () => {
    const result = parseArgs(['node', 'blast-radius', 'analyze']);
    expect(result.command).toBe('analyze');
    expect(result.flags).toEqual({});
  });

  it('parses command with string flags', () => {
    const result = parseArgs([
      'node',
      'blast-radius',
      'analyze',
      '--format',
      'terraform-plan',
      '--input',
      'plan.json',
    ]);
    expect(result.command).toBe('analyze');
    expect(result.flags.format).toBe('terraform-plan');
    expect(result.flags.input).toBe('plan.json');
  });

  it('parses boolean flags', () => {
    const result = parseArgs(['node', 'blast-radius', 'analyze', '--ci']);
    expect(result.command).toBe('analyze');
    expect(result.flags.ci).toBe(true);
  });

  it('parses threshold as string value', () => {
    const result = parseArgs([
      'node',
      'blast-radius',
      'analyze',
      '--threshold',
      '75',
    ]);
    expect(result.flags.threshold).toBe('75');
  });

  it('parses analysis-id flag', () => {
    const result = parseArgs([
      'node',
      'blast-radius',
      'status',
      '--analysis-id',
      'abc-123',
    ]);
    expect(result.command).toBe('status');
    expect(result.flags['analysis-id']).toBe('abc-123');
  });

  it('returns empty command when no args', () => {
    const result = parseArgs(['node', 'blast-radius']);
    expect(result.command).toBe('');
  });
});

// ─── analyze command Tests ───────────────────────────────────────────────────

describe('handleAnalyze', () => {
  it('returns error when no input provided', async () => {
    const client = createMockApiClient();
    const result = await handleAnalyze({ ci: false }, client, '');
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('--input');
  });

  it('returns error for invalid JSON input', async () => {
    const client = createMockApiClient();
    const result = await handleAnalyze({ ci: false }, client, 'not json');
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('Invalid JSON');
  });

  it('returns error for invalid threshold', async () => {
    const client = createMockApiClient();
    const result = await handleAnalyze(
      { threshold: 150, ci: false },
      client,
      '{"resources": []}'
    );
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('0-100');
  });

  it('submits analysis and returns results in CI mode', async () => {
    const client = createMockApiClient();
    const result = await handleAnalyze(
      { format: 'canonical', ci: true },
      client,
      '{"resources": []}'
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.analysisId).toBe('test-analysis-123');
  });

  it('returns pass verdict when threshold not exceeded', async () => {
    const analysisResult = createMockAnalysisResult({
      scoredResources: [
        {
          resourceId: 'sg-123',
          resourceType: 'aws_security_group',
          provider: 'aws',
          region: 'us-east-1',
          accountId: '123456789012',
          impactScore: 50,
          riskCategory: 'High',
          dependencyChain: ['vpc-1', 'sg-123'],
          dependencyDepth: 2,
          criticalityClassification: 'Medium',
          changeTypeSeverity: 50,
          highestRiskPath: [],
        },
      ],
      riskSummary: {
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
        totalAffected: 1,
        highestScore: 50,
      },
    });
    const client = createMockApiClient({
      submitAnalysis: vi.fn().mockResolvedValue(analysisResult),
    });

    const result = await handleAnalyze(
      { threshold: 75, ci: true },
      client,
      '{"resources": []}'
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.verdict).toBe('pass');
  });

  it('returns fail verdict when threshold exceeded', async () => {
    const analysisResult = createMockAnalysisResult({
      scoredResources: [
        {
          resourceId: 'rds-prod',
          resourceType: 'aws_db_instance',
          provider: 'aws',
          region: 'us-east-1',
          accountId: '123456789012',
          impactScore: 90,
          riskCategory: 'Critical',
          dependencyChain: ['vpc-1', 'subnet-1', 'rds-prod'],
          dependencyDepth: 3,
          criticalityClassification: 'Critical',
          changeTypeSeverity: 100,
          highestRiskPath: [],
        },
      ],
      riskSummary: {
        critical: 1,
        high: 0,
        medium: 0,
        low: 0,
        totalAffected: 1,
        highestScore: 90,
      },
    });
    const client = createMockApiClient({
      submitAnalysis: vi.fn().mockResolvedValue(analysisResult),
    });

    const result = await handleAnalyze(
      { threshold: 75, ci: true },
      client,
      '{"resources": []}'
    );
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.output);
    expect(parsed.verdict).toBe('fail');
    expect(parsed.exceedingResources).toHaveLength(1);
    expect(parsed.exceedingResources[0].resourceId).toBe('rds-prod');
  });

  it('returns exit code 2 when API call fails', async () => {
    const client = createMockApiClient({
      submitAnalysis: vi.fn().mockRejectedValue(new Error('Connection refused')),
    });

    const result = await handleAnalyze(
      { ci: true },
      client,
      '{"resources": []}'
    );
    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.output);
    expect(parsed.error).toContain('Connection refused');
  });

  it('returns human-readable output when not in CI mode', async () => {
    const client = createMockApiClient();
    const result = await handleAnalyze(
      { format: 'canonical', ci: false },
      client,
      '{"resources": []}'
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Analysis ID:');
    expect(result.output).toContain('Risk Summary:');
  });
});

// ─── status command Tests ────────────────────────────────────────────────────

describe('handleStatus', () => {
  it('returns error when analysis-id is missing', async () => {
    const client = createMockApiClient();
    const result = await handleStatus({ analysisId: '' }, client, true);
    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.output);
    expect(parsed.error).toContain('--analysis-id is required');
  });

  it('returns status in CI mode as JSON', async () => {
    const client = createMockApiClient();
    const result = await handleStatus(
      { analysisId: 'test-123' },
      client,
      true
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.analysisId).toBe('test-analysis-123');
    expect(parsed.status).toBe('running');
    expect(parsed.progressPercentage).toBe(50);
  });

  it('returns human-readable status when not in CI mode', async () => {
    const client = createMockApiClient();
    const result = await handleStatus(
      { analysisId: 'test-123' },
      client,
      false
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Analysis ID:');
    expect(result.output).toContain('Progress: 50%');
  });

  it('returns error when API call fails', async () => {
    const client = createMockApiClient({
      getStatus: vi.fn().mockRejectedValue(new Error('Not found')),
    });
    const result = await handleStatus(
      { analysisId: 'bad-id' },
      client,
      true
    );
    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.output);
    expect(parsed.error).toContain('Not found');
  });
});

// ─── export command Tests ────────────────────────────────────────────────────

describe('handleExport', () => {
  it('returns error when analysis-id is missing', async () => {
    const client = createMockApiClient();
    const result = await handleExport(
      { analysisId: '', format: 'json' },
      client,
      true
    );
    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.output);
    expect(parsed.error).toContain('--analysis-id is required');
  });

  it('returns error for unsupported format', async () => {
    const client = createMockApiClient();
    const result = await handleExport(
      { analysisId: 'test-123', format: 'csv' },
      client,
      true
    );
    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.output);
    expect(parsed.error).toContain('Unsupported export format');
  });

  it('exports JSON results successfully', async () => {
    const client = createMockApiClient();
    const result = await handleExport(
      { analysisId: 'test-123', format: 'json' },
      client,
      true
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.analysisId).toBe('test-analysis-123');
  });

  it('defaults to json format when not specified', async () => {
    const client = createMockApiClient();
    const result = await handleExport(
      { analysisId: 'test-123' },
      client,
      true
    );
    expect(result.exitCode).toBe(0);
    expect(client.getExport).toHaveBeenCalledWith('test-123', 'json');
  });

  it('returns error when API call fails', async () => {
    const client = createMockApiClient({
      getExport: vi.fn().mockRejectedValue(new Error('Timeout')),
    });
    const result = await handleExport(
      { analysisId: 'test-123', format: 'json' },
      client,
      true
    );
    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.output);
    expect(parsed.error).toContain('Timeout');
  });
});

// ─── formatVerdict Tests ─────────────────────────────────────────────────────

describe('formatVerdict', () => {
  it('formats pass verdict in CI mode as JSON', () => {
    const result = formatVerdict(
      { verdict: 'pass', exitCode: 0, summary: { totalAffected: 5, highestScore: 60 } },
      true
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.verdict).toBe('pass');
    expect(parsed.summary.totalAffected).toBe(5);
  });

  it('formats fail verdict in CI mode as JSON', () => {
    const result = formatVerdict(
      {
        verdict: 'fail',
        exitCode: 1,
        exceedingResources: [
          {
            resourceId: 'rds-1',
            resourceType: 'aws_db_instance',
            impactScore: 90,
            riskCategory: 'Critical',
            dependencyChain: ['vpc-1', 'rds-1'],
          },
        ],
        summary: { totalAffected: 3, highestScore: 90, exceedingCount: 1 },
      },
      true
    );
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.output);
    expect(parsed.verdict).toBe('fail');
    expect(parsed.exceedingResources).toHaveLength(1);
  });

  it('formats error verdict in CI mode as JSON', () => {
    const result = formatVerdict(
      { verdict: 'error', exitCode: 2, message: 'Invalid threshold' },
      true
    );
    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.output);
    expect(parsed.verdict).toBe('error');
  });

  it('formats pass verdict in human mode', () => {
    const result = formatVerdict(
      { verdict: 'pass', exitCode: 0, summary: { totalAffected: 5, highestScore: 60 } },
      false
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('PASS');
    expect(result.output).toContain('5');
    expect(result.output).toContain('60');
  });

  it('formats fail verdict in human mode', () => {
    const result = formatVerdict(
      {
        verdict: 'fail',
        exitCode: 1,
        exceedingResources: [
          {
            resourceId: 'rds-1',
            resourceType: 'aws_db_instance',
            impactScore: 90,
            riskCategory: 'Critical',
            dependencyChain: ['vpc-1', 'rds-1'],
          },
        ],
        summary: { totalAffected: 3, highestScore: 90, exceedingCount: 1 },
      },
      false
    );
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('FAIL');
    expect(result.output).toContain('rds-1');
  });
});

// ─── formatError Tests ───────────────────────────────────────────────────────

describe('formatError', () => {
  it('formats error in CI mode as JSON', () => {
    const result = formatError('Something went wrong', true);
    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.output);
    expect(parsed.error).toBe('Something went wrong');
  });

  it('formats error in human mode', () => {
    const result = formatError('Something went wrong', false);
    expect(result.exitCode).toBe(2);
    expect(result.output).toBe('Error: Something went wrong');
  });
});

// ─── main() Integration Tests ────────────────────────────────────────────────

describe('main', () => {
  it('returns error for unknown command', async () => {
    const client = createMockApiClient();
    const result = await main(['node', 'blast-radius', 'unknown'], client);
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('Unknown command');
    expect(result.output).toContain('Usage:');
  });

  it('returns error for empty command', async () => {
    const client = createMockApiClient();
    const result = await main(['node', 'blast-radius'], client);
    expect(result.exitCode).toBe(2);
  });

  it('routes analyze command correctly', async () => {
    const client = createMockApiClient();
    const result = await main(
      ['node', 'blast-radius', 'analyze', '--format', 'canonical', '--ci'],
      client,
      '{"resources": []}'
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.analysisId).toBe('test-analysis-123');
  });

  it('routes status command correctly', async () => {
    const client = createMockApiClient();
    const result = await main(
      ['node', 'blast-radius', 'status', '--analysis-id', 'test-123', '--ci'],
      client
    );
    // CI flag is not passed to status via main, but the output is still valid
    expect(result.exitCode).toBe(0);
  });

  it('routes export command correctly', async () => {
    const client = createMockApiClient();
    const result = await main(
      [
        'node',
        'blast-radius',
        'export',
        '--analysis-id',
        'test-123',
        '--format',
        'json',
      ],
      client
    );
    expect(result.exitCode).toBe(0);
  });

  it('parses threshold as number for analyze command', async () => {
    const analysisResult = createMockAnalysisResult({
      scoredResources: [
        {
          resourceId: 'sg-123',
          resourceType: 'aws_security_group',
          provider: 'aws',
          region: 'us-east-1',
          accountId: '123456789012',
          impactScore: 30,
          riskCategory: 'Medium',
          dependencyChain: ['vpc-1', 'sg-123'],
          dependencyDepth: 2,
          criticalityClassification: 'Medium',
          changeTypeSeverity: 50,
          highestRiskPath: [],
        },
      ],
    });
    const client = createMockApiClient({
      submitAnalysis: vi.fn().mockResolvedValue(analysisResult),
    });

    const result = await main(
      [
        'node',
        'blast-radius',
        'analyze',
        '--threshold',
        '75',
        '--ci',
      ],
      client,
      '{"resources": []}'
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.verdict).toBe('pass');
  });

  it('exit code 1 when threshold exceeded via main', async () => {
    const analysisResult = createMockAnalysisResult({
      scoredResources: [
        {
          resourceId: 'rds-prod',
          resourceType: 'aws_db_instance',
          provider: 'aws',
          region: 'us-east-1',
          accountId: '123456789012',
          impactScore: 95,
          riskCategory: 'Critical',
          dependencyChain: ['vpc-1', 'rds-prod'],
          dependencyDepth: 2,
          criticalityClassification: 'Critical',
          changeTypeSeverity: 100,
          highestRiskPath: [],
        },
      ],
    });
    const client = createMockApiClient({
      submitAnalysis: vi.fn().mockResolvedValue(analysisResult),
    });

    const result = await main(
      ['node', 'blast-radius', 'analyze', '--threshold', '50', '--ci'],
      client,
      '{"resources": []}'
    );
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.output);
    expect(parsed.verdict).toBe('fail');
  });
});
