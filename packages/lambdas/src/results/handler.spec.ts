/**
 * Unit tests for the Result Retrieval Authorization handler.
 *
 * Validates: Requirements 9.7
 */

import { describe, it, expect, vi } from 'vitest';
import { handler } from './handler';
import type { ResultsHandlerDeps, GetResultInput, ListResultsInput } from './handler';
import type { AnalysisResult, AuthorizationPolicy } from '@blast-radius/core';

// ─── Mock Factory ────────────────────────────────────────────────────────────

function createMockDeps(options?: {
  statusItem?: Record<string, unknown> | null;
  s3Result?: AnalysisResult | null;
  policy?: AuthorizationPolicy;
}): ResultsHandlerDeps {
  const statusItem = options?.statusItem ?? null;
  const s3Result = options?.s3Result ?? null;
  const policy = options?.policy ?? {
    authorizedAccounts: ['123456789012'],
    authorizedRegions: [],
  };

  const docClient = {
    send: vi.fn().mockImplementation((command: unknown) => {
      const cmd = command as { input: Record<string, unknown>; constructor: { name: string } };
      // GetCommand
      if (cmd.input.Key) {
        return Promise.resolve({ Item: statusItem });
      }
      // QueryCommand (for list operations)
      return Promise.resolve({ Items: statusItem ? [statusItem] : [], LastEvaluatedKey: undefined });
    }),
  };

  const s3Client = {
    send: vi.fn().mockImplementation(() => {
      if (!s3Result) {
        return Promise.reject(new Error('NoSuchKey'));
      }
      return Promise.resolve({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(s3Result)),
        },
      });
    }),
  };

  const authResolver = {
    resolvePolicy: vi.fn().mockResolvedValue(policy),
  };

  return {
    docClient: docClient as unknown as ResultsHandlerDeps['docClient'],
    s3Client: s3Client as unknown as ResultsHandlerDeps['s3Client'],
    authResolver,
  };
}

function createAnalysisResult(overrides?: Partial<AnalysisResult>): AnalysisResult {
  return {
    analysisId: 'analysis-001',
    status: 'completed',
    requestingPrincipal: 'arn:aws:iam::123456789012:user/alice',
    originatingAccountId: '123456789012',
    sourceFormat: 'cloudformation',
    submittedAt: '2024-01-15T10:30:00Z',
    completedAt: '2024-01-15T10:31:00Z',
    manifest: {
      version: '1.0',
      metadata: { submittedAt: '2024-01-15T10:30:00Z', sourceFormat: 'cloudformation' },
      resources: [],
    },
    dependencyGraph: { nodes: [], edges: [] },
    scoredResources: [
      {
        resourceId: 'i-12345',
        resourceType: 'AWS::EC2::Instance',
        provider: 'aws',
        region: 'us-east-1',
        accountId: '123456789012',
        impactScore: 80,
        riskCategory: 'Critical',
        dependencyChain: ['sg-001', 'i-12345'],
        dependencyDepth: 1,
        criticalityClassification: 'High',
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
      highestScore: 80,
    },
    stageDurations: { Ingestion: 1000, Discovery: 5000, Scoring: 2000 },
    completedStages: ['Ingestion', 'Discovery', 'Scoring', 'VisualizationPrep'],
    ...overrides,
  };
}

function createStatusItem(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    analysisId: 'analysis-001',
    requestingPrincipal: 'arn:aws:iam::123456789012:user/alice',
    originatingAccountId: '123456789012',
    status: 'completed',
    currentStage: 'Complete',
    progressPercentage: 100,
    startedAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T10:31:00Z',
    resultLocation: 'results/analysis-001/analysis-result.json',
    ...overrides,
  };
}

function createRequestContext(principalArn: string, accountId: string) {
  return {
    identity: {
      userArn: principalArn,
      accountId,
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Results Retrieval Handler', () => {
  describe('input validation', () => {
    it('rejects null input', async () => {
      const deps = createMockDeps();
      const result = await handler(null as unknown as GetResultInput, deps);
      expect(result).toEqual({
        error: 'Invalid input: expected an object with an "operation" field',
        statusCode: 400,
      });
    });

    it('rejects invalid operation', async () => {
      const deps = createMockDeps();
      const result = await handler({ operation: 'delete' } as unknown as GetResultInput, deps);
      expect(result).toEqual({
        error: 'Invalid operation: must be "get" or "list"',
        statusCode: 400,
      });
    });

    it('rejects request without SigV4 identity', async () => {
      const deps = createMockDeps();
      const input: GetResultInput = {
        operation: 'get',
        analysisId: 'analysis-001',
        requestContext: undefined,
      };
      const result = await handler(input, deps);
      expect(result).toHaveProperty('statusCode', 401);
    });

    it('rejects get request without analysisId', async () => {
      const deps = createMockDeps();
      const input: GetResultInput = {
        operation: 'get',
        analysisId: '',
        requestContext: createRequestContext(
          'arn:aws:iam::123456789012:user/alice',
          '123456789012',
        ),
      };
      const result = await handler(input, deps);
      expect(result).toEqual({
        error: 'Missing or invalid "analysisId" field',
        statusCode: 400,
      });
    });
  });

  describe('get operation - owner access', () => {
    it('returns full results when the requesting principal is the owner', async () => {
      const analysisResult = createAnalysisResult();
      const statusItem = createStatusItem();
      const deps = createMockDeps({ statusItem, s3Result: analysisResult });

      const input: GetResultInput = {
        operation: 'get',
        analysisId: 'analysis-001',
        requestContext: createRequestContext(
          'arn:aws:iam::123456789012:user/alice',
          '123456789012',
        ),
      };

      const result = await handler(input, deps);

      expect(result).toHaveProperty('result');
      const output = result as { result: AnalysisResult; exclusionSummary: unknown };
      expect(output.result.analysisId).toBe('analysis-001');
      expect(output.result.scoredResources).toHaveLength(1);
      expect(output.exclusionSummary).toEqual({
        excludedAccounts: [],
        excludedRegions: [],
        omittedResourceCount: 0,
        reason: 'All resources are within authorized scope.',
      });
    });

    it('returns 404 when analysis does not exist', async () => {
      const deps = createMockDeps({ statusItem: null });

      const input: GetResultInput = {
        operation: 'get',
        analysisId: 'nonexistent',
        requestContext: createRequestContext(
          'arn:aws:iam::123456789012:user/alice',
          '123456789012',
        ),
      };

      const result = await handler(input, deps);
      expect(result).toEqual({
        error: 'Analysis not found: nonexistent',
        statusCode: 404,
      });
    });

    it('returns 404 when result is not yet available (still running)', async () => {
      const statusItem = createStatusItem({ resultLocation: undefined, status: 'running' });
      const deps = createMockDeps({ statusItem });

      const input: GetResultInput = {
        operation: 'get',
        analysisId: 'analysis-001',
        requestContext: createRequestContext(
          'arn:aws:iam::123456789012:user/alice',
          '123456789012',
        ),
      };

      const result = await handler(input, deps);
      expect(result).toHaveProperty('statusCode', 404);
      expect(result).toHaveProperty('error');
    });
  });

  describe('get operation - account-based access', () => {
    it('allows access when principal is authorized for the originating account', async () => {
      const analysisResult = createAnalysisResult({
        requestingPrincipal: 'arn:aws:iam::123456789012:user/alice',
      });
      const statusItem = createStatusItem({
        requestingPrincipal: 'arn:aws:iam::123456789012:user/alice',
        originatingAccountId: '123456789012',
      });

      // Bob is authorized for account 123456789012
      const deps = createMockDeps({
        statusItem,
        s3Result: analysisResult,
        policy: { authorizedAccounts: ['123456789012', '987654321098'], authorizedRegions: [] },
      });

      const input: GetResultInput = {
        operation: 'get',
        analysisId: 'analysis-001',
        requestContext: createRequestContext(
          'arn:aws:iam::987654321098:user/bob',
          '987654321098',
        ),
      };

      const result = await handler(input, deps);
      expect(result).toHaveProperty('result');
    });

    it('denies access when principal is not authorized for the originating account', async () => {
      const statusItem = createStatusItem({
        requestingPrincipal: 'arn:aws:iam::123456789012:user/alice',
        originatingAccountId: '123456789012',
      });

      // Bob is only authorized for his own account 987654321098
      const deps = createMockDeps({
        statusItem,
        policy: { authorizedAccounts: ['987654321098'], authorizedRegions: [] },
      });

      const input: GetResultInput = {
        operation: 'get',
        analysisId: 'analysis-001',
        requestContext: createRequestContext(
          'arn:aws:iam::987654321098:user/bob',
          '987654321098',
        ),
      };

      const result = await handler(input, deps);
      expect(result).toEqual({
        error: 'Access denied: you are not authorized to view this analysis result',
        statusCode: 403,
      });
    });

    it('scopes results for non-owner access, filtering unauthorized resources', async () => {
      const analysisResult = createAnalysisResult({
        requestingPrincipal: 'arn:aws:iam::123456789012:user/alice',
        scoredResources: [
          {
            resourceId: 'i-12345',
            resourceType: 'AWS::EC2::Instance',
            provider: 'aws',
            region: 'us-east-1',
            accountId: '123456789012',
            impactScore: 80,
            riskCategory: 'Critical',
            dependencyChain: ['sg-001', 'i-12345'],
            dependencyDepth: 1,
            criticalityClassification: 'High',
            changeTypeSeverity: 100,
            highestRiskPath: [],
          },
          {
            resourceId: 'rds-99999',
            resourceType: 'AWS::RDS::DBInstance',
            provider: 'aws',
            region: 'us-east-1',
            accountId: '555555555555',
            impactScore: 90,
            riskCategory: 'Critical',
            dependencyChain: ['sg-001', 'rds-99999'],
            dependencyDepth: 1,
            criticalityClassification: 'Critical',
            changeTypeSeverity: 100,
            highestRiskPath: [],
          },
        ],
        dependencyGraph: {
          nodes: [
            {
              resourceId: 'i-12345',
              resourceType: 'AWS::EC2::Instance',
              provider: 'aws',
              region: 'us-east-1',
              accountId: '123456789012',
              isDirectChange: false,
              dependencyCoverage: 'full',
            },
            {
              resourceId: 'rds-99999',
              resourceType: 'AWS::RDS::DBInstance',
              provider: 'aws',
              region: 'us-east-1',
              accountId: '555555555555',
              isDirectChange: false,
              dependencyCoverage: 'full',
            },
          ],
          edges: [],
        },
      });
      const statusItem = createStatusItem({
        requestingPrincipal: 'arn:aws:iam::123456789012:user/alice',
        originatingAccountId: '123456789012',
      });

      // Bob is authorized for accounts 123456789012 but NOT 555555555555
      const deps = createMockDeps({
        statusItem,
        s3Result: analysisResult,
        policy: { authorizedAccounts: ['123456789012', '987654321098'], authorizedRegions: [] },
      });

      const input: GetResultInput = {
        operation: 'get',
        analysisId: 'analysis-001',
        requestContext: createRequestContext(
          'arn:aws:iam::987654321098:user/bob',
          '987654321098',
        ),
      };

      const result = await handler(input, deps);
      expect(result).toHaveProperty('result');
      const output = result as { result: AnalysisResult; exclusionSummary: { excludedAccounts: string[]; omittedResourceCount: number } };

      // Only the resource from account 123456789012 should be included
      expect(output.result.scoredResources).toHaveLength(1);
      expect(output.result.scoredResources[0].resourceId).toBe('i-12345');

      // Exclusion summary should mention the excluded account
      expect(output.exclusionSummary.excludedAccounts).toContain('555555555555');
      expect(output.exclusionSummary.omittedResourceCount).toBe(1);
    });
  });

  describe('list operation', () => {
    it('returns results owned by the requesting principal', async () => {
      const statusItem = createStatusItem();
      const deps = createMockDeps({ statusItem });

      const input: ListResultsInput = {
        operation: 'list',
        requestContext: createRequestContext(
          'arn:aws:iam::123456789012:user/alice',
          '123456789012',
        ),
      };

      const result = await handler(input, deps);
      expect(result).toHaveProperty('results');
      const output = result as { results: Array<{ analysisId: string }> };
      expect(output.results).toHaveLength(1);
      expect(output.results[0].analysisId).toBe('analysis-001');
    });

    it('rejects list request without SigV4 identity', async () => {
      const deps = createMockDeps();
      const input: ListResultsInput = {
        operation: 'list',
        requestContext: undefined,
      };
      const result = await handler(input, deps);
      expect(result).toHaveProperty('statusCode', 401);
    });
  });

  describe('S3 retrieval errors', () => {
    it('returns 500 when S3 retrieval fails', async () => {
      const statusItem = createStatusItem();
      const deps = createMockDeps({ statusItem, s3Result: null });

      const input: GetResultInput = {
        operation: 'get',
        analysisId: 'analysis-001',
        requestContext: createRequestContext(
          'arn:aws:iam::123456789012:user/alice',
          '123456789012',
        ),
      };

      const result = await handler(input, deps);
      expect(result).toEqual({
        error: 'Failed to retrieve analysis result from storage',
        statusCode: 500,
      });
    });
  });
});
