"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = require("./index");
// ─── Test Helpers ────────────────────────────────────────────────────────────
function createMockAnalysisResult(overrides) {
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
function createMockStatus(overrides) {
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
function createMockApiClient(overrides) {
    return {
        submitAnalysis: vitest_1.vi.fn().mockResolvedValue(createMockAnalysisResult()),
        getStatus: vitest_1.vi.fn().mockResolvedValue(createMockStatus()),
        getExport: vitest_1.vi.fn().mockResolvedValue(createMockAnalysisResult()),
        ...overrides,
    };
}
// ─── parseArgs Tests ─────────────────────────────────────────────────────────
(0, vitest_1.describe)('parseArgs', () => {
    (0, vitest_1.it)('parses command with no flags', () => {
        const result = (0, index_1.parseArgs)(['node', 'blast-radius', 'analyze']);
        (0, vitest_1.expect)(result.command).toBe('analyze');
        (0, vitest_1.expect)(result.flags).toEqual({});
    });
    (0, vitest_1.it)('parses command with string flags', () => {
        const result = (0, index_1.parseArgs)([
            'node',
            'blast-radius',
            'analyze',
            '--format',
            'terraform-plan',
            '--input',
            'plan.json',
        ]);
        (0, vitest_1.expect)(result.command).toBe('analyze');
        (0, vitest_1.expect)(result.flags.format).toBe('terraform-plan');
        (0, vitest_1.expect)(result.flags.input).toBe('plan.json');
    });
    (0, vitest_1.it)('parses boolean flags', () => {
        const result = (0, index_1.parseArgs)(['node', 'blast-radius', 'analyze', '--ci']);
        (0, vitest_1.expect)(result.command).toBe('analyze');
        (0, vitest_1.expect)(result.flags.ci).toBe(true);
    });
    (0, vitest_1.it)('parses threshold as string value', () => {
        const result = (0, index_1.parseArgs)([
            'node',
            'blast-radius',
            'analyze',
            '--threshold',
            '75',
        ]);
        (0, vitest_1.expect)(result.flags.threshold).toBe('75');
    });
    (0, vitest_1.it)('parses analysis-id flag', () => {
        const result = (0, index_1.parseArgs)([
            'node',
            'blast-radius',
            'status',
            '--analysis-id',
            'abc-123',
        ]);
        (0, vitest_1.expect)(result.command).toBe('status');
        (0, vitest_1.expect)(result.flags['analysis-id']).toBe('abc-123');
    });
    (0, vitest_1.it)('returns empty command when no args', () => {
        const result = (0, index_1.parseArgs)(['node', 'blast-radius']);
        (0, vitest_1.expect)(result.command).toBe('');
    });
});
// ─── analyze command Tests ───────────────────────────────────────────────────
(0, vitest_1.describe)('handleAnalyze', () => {
    (0, vitest_1.it)('returns error when no input provided', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.handleAnalyze)({ ci: false }, client, '');
        (0, vitest_1.expect)(result.exitCode).toBe(2);
        (0, vitest_1.expect)(result.output).toContain('No input provided');
    });
    (0, vitest_1.it)('returns error for invalid JSON input', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.handleAnalyze)({ ci: false }, client, 'not json');
        (0, vitest_1.expect)(result.exitCode).toBe(2);
        (0, vitest_1.expect)(result.output).toContain('Invalid JSON');
    });
    (0, vitest_1.it)('returns error for invalid threshold', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.handleAnalyze)({ threshold: 150, ci: false }, client, '{"resources": []}');
        (0, vitest_1.expect)(result.exitCode).toBe(2);
        (0, vitest_1.expect)(result.output).toContain('0-100');
    });
    (0, vitest_1.it)('submits analysis and returns results in CI mode', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.handleAnalyze)({ format: 'canonical', ci: true }, client, '{"resources": []}');
        (0, vitest_1.expect)(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.analysisId).toBe('test-analysis-123');
    });
    (0, vitest_1.it)('returns pass verdict when threshold not exceeded', async () => {
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
            submitAnalysis: vitest_1.vi.fn().mockResolvedValue(analysisResult),
        });
        const result = await (0, index_1.handleAnalyze)({ threshold: 75, ci: true }, client, '{"resources": []}');
        (0, vitest_1.expect)(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.verdict).toBe('pass');
    });
    (0, vitest_1.it)('returns fail verdict when threshold exceeded', async () => {
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
            submitAnalysis: vitest_1.vi.fn().mockResolvedValue(analysisResult),
        });
        const result = await (0, index_1.handleAnalyze)({ threshold: 75, ci: true }, client, '{"resources": []}');
        (0, vitest_1.expect)(result.exitCode).toBe(1);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.verdict).toBe('fail');
        (0, vitest_1.expect)(parsed.exceedingResources).toHaveLength(1);
        (0, vitest_1.expect)(parsed.exceedingResources[0].resourceId).toBe('rds-prod');
    });
    (0, vitest_1.it)('returns exit code 2 when API call fails', async () => {
        const client = createMockApiClient({
            submitAnalysis: vitest_1.vi.fn().mockRejectedValue(new Error('Connection refused')),
        });
        const result = await (0, index_1.handleAnalyze)({ ci: true }, client, '{"resources": []}');
        (0, vitest_1.expect)(result.exitCode).toBe(2);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.error).toContain('Connection refused');
    });
    (0, vitest_1.it)('returns human-readable output when not in CI mode', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.handleAnalyze)({ format: 'canonical', ci: false }, client, '{"resources": []}');
        (0, vitest_1.expect)(result.exitCode).toBe(0);
        (0, vitest_1.expect)(result.output).toContain('Analysis ID:');
        (0, vitest_1.expect)(result.output).toContain('Risk Summary:');
    });
});
// ─── status command Tests ────────────────────────────────────────────────────
(0, vitest_1.describe)('handleStatus', () => {
    (0, vitest_1.it)('returns error when analysis-id is missing', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.handleStatus)({ analysisId: '' }, client, true);
        (0, vitest_1.expect)(result.exitCode).toBe(2);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.error).toContain('--analysis-id is required');
    });
    (0, vitest_1.it)('returns status in CI mode as JSON', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.handleStatus)({ analysisId: 'test-123' }, client, true);
        (0, vitest_1.expect)(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.analysisId).toBe('test-analysis-123');
        (0, vitest_1.expect)(parsed.status).toBe('running');
        (0, vitest_1.expect)(parsed.progressPercentage).toBe(50);
    });
    (0, vitest_1.it)('returns human-readable status when not in CI mode', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.handleStatus)({ analysisId: 'test-123' }, client, false);
        (0, vitest_1.expect)(result.exitCode).toBe(0);
        (0, vitest_1.expect)(result.output).toContain('Analysis ID:');
        (0, vitest_1.expect)(result.output).toContain('Progress: 50%');
    });
    (0, vitest_1.it)('returns error when API call fails', async () => {
        const client = createMockApiClient({
            getStatus: vitest_1.vi.fn().mockRejectedValue(new Error('Not found')),
        });
        const result = await (0, index_1.handleStatus)({ analysisId: 'bad-id' }, client, true);
        (0, vitest_1.expect)(result.exitCode).toBe(2);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.error).toContain('Not found');
    });
});
// ─── export command Tests ────────────────────────────────────────────────────
(0, vitest_1.describe)('handleExport', () => {
    (0, vitest_1.it)('returns error when analysis-id is missing', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.handleExport)({ analysisId: '', format: 'json' }, client, true);
        (0, vitest_1.expect)(result.exitCode).toBe(2);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.error).toContain('--analysis-id is required');
    });
    (0, vitest_1.it)('returns error for unsupported format', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.handleExport)({ analysisId: 'test-123', format: 'csv' }, client, true);
        (0, vitest_1.expect)(result.exitCode).toBe(2);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.error).toContain('Unsupported export format');
    });
    (0, vitest_1.it)('exports JSON results successfully', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.handleExport)({ analysisId: 'test-123', format: 'json' }, client, true);
        (0, vitest_1.expect)(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.analysisId).toBe('test-analysis-123');
    });
    (0, vitest_1.it)('defaults to json format when not specified', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.handleExport)({ analysisId: 'test-123' }, client, true);
        (0, vitest_1.expect)(result.exitCode).toBe(0);
        (0, vitest_1.expect)(client.getExport).toHaveBeenCalledWith('test-123', 'json');
    });
    (0, vitest_1.it)('returns error when API call fails', async () => {
        const client = createMockApiClient({
            getExport: vitest_1.vi.fn().mockRejectedValue(new Error('Timeout')),
        });
        const result = await (0, index_1.handleExport)({ analysisId: 'test-123', format: 'json' }, client, true);
        (0, vitest_1.expect)(result.exitCode).toBe(2);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.error).toContain('Timeout');
    });
});
// ─── formatVerdict Tests ─────────────────────────────────────────────────────
(0, vitest_1.describe)('formatVerdict', () => {
    (0, vitest_1.it)('formats pass verdict in CI mode as JSON', () => {
        const result = (0, index_1.formatVerdict)({ verdict: 'pass', exitCode: 0, summary: { totalAffected: 5, highestScore: 60 } }, true);
        (0, vitest_1.expect)(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.verdict).toBe('pass');
        (0, vitest_1.expect)(parsed.summary.totalAffected).toBe(5);
    });
    (0, vitest_1.it)('formats fail verdict in CI mode as JSON', () => {
        const result = (0, index_1.formatVerdict)({
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
        }, true);
        (0, vitest_1.expect)(result.exitCode).toBe(1);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.verdict).toBe('fail');
        (0, vitest_1.expect)(parsed.exceedingResources).toHaveLength(1);
    });
    (0, vitest_1.it)('formats error verdict in CI mode as JSON', () => {
        const result = (0, index_1.formatVerdict)({ verdict: 'error', exitCode: 2, message: 'Invalid threshold' }, true);
        (0, vitest_1.expect)(result.exitCode).toBe(2);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.verdict).toBe('error');
    });
    (0, vitest_1.it)('formats pass verdict in human mode', () => {
        const result = (0, index_1.formatVerdict)({ verdict: 'pass', exitCode: 0, summary: { totalAffected: 5, highestScore: 60 } }, false);
        (0, vitest_1.expect)(result.exitCode).toBe(0);
        (0, vitest_1.expect)(result.output).toContain('PASS');
        (0, vitest_1.expect)(result.output).toContain('5');
        (0, vitest_1.expect)(result.output).toContain('60');
    });
    (0, vitest_1.it)('formats fail verdict in human mode', () => {
        const result = (0, index_1.formatVerdict)({
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
        }, false);
        (0, vitest_1.expect)(result.exitCode).toBe(1);
        (0, vitest_1.expect)(result.output).toContain('FAIL');
        (0, vitest_1.expect)(result.output).toContain('rds-1');
    });
});
// ─── formatError Tests ───────────────────────────────────────────────────────
(0, vitest_1.describe)('formatError', () => {
    (0, vitest_1.it)('formats error in CI mode as JSON', () => {
        const result = (0, index_1.formatError)('Something went wrong', true);
        (0, vitest_1.expect)(result.exitCode).toBe(2);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.error).toBe('Something went wrong');
    });
    (0, vitest_1.it)('formats error in human mode', () => {
        const result = (0, index_1.formatError)('Something went wrong', false);
        (0, vitest_1.expect)(result.exitCode).toBe(2);
        (0, vitest_1.expect)(result.output).toBe('Error: Something went wrong');
    });
});
// ─── main() Integration Tests ────────────────────────────────────────────────
(0, vitest_1.describe)('main', () => {
    (0, vitest_1.it)('returns error for unknown command', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.main)(['node', 'blast-radius', 'unknown'], client);
        (0, vitest_1.expect)(result.exitCode).toBe(2);
        (0, vitest_1.expect)(result.output).toContain('Unknown command');
        (0, vitest_1.expect)(result.output).toContain('Usage:');
    });
    (0, vitest_1.it)('returns error for empty command', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.main)(['node', 'blast-radius'], client);
        (0, vitest_1.expect)(result.exitCode).toBe(2);
    });
    (0, vitest_1.it)('routes analyze command correctly', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.main)(['node', 'blast-radius', 'analyze', '--format', 'canonical', '--ci'], client, '{"resources": []}');
        (0, vitest_1.expect)(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.analysisId).toBe('test-analysis-123');
    });
    (0, vitest_1.it)('routes status command correctly', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.main)(['node', 'blast-radius', 'status', '--analysis-id', 'test-123', '--ci'], client);
        // CI flag is not passed to status via main, but the output is still valid
        (0, vitest_1.expect)(result.exitCode).toBe(0);
    });
    (0, vitest_1.it)('routes export command correctly', async () => {
        const client = createMockApiClient();
        const result = await (0, index_1.main)([
            'node',
            'blast-radius',
            'export',
            '--analysis-id',
            'test-123',
            '--format',
            'json',
        ], client);
        (0, vitest_1.expect)(result.exitCode).toBe(0);
    });
    (0, vitest_1.it)('parses threshold as number for analyze command', async () => {
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
            submitAnalysis: vitest_1.vi.fn().mockResolvedValue(analysisResult),
        });
        const result = await (0, index_1.main)([
            'node',
            'blast-radius',
            'analyze',
            '--threshold',
            '75',
            '--ci',
        ], client, '{"resources": []}');
        (0, vitest_1.expect)(result.exitCode).toBe(0);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.verdict).toBe('pass');
    });
    (0, vitest_1.it)('exit code 1 when threshold exceeded via main', async () => {
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
            submitAnalysis: vitest_1.vi.fn().mockResolvedValue(analysisResult),
        });
        const result = await (0, index_1.main)(['node', 'blast-radius', 'analyze', '--threshold', '50', '--ci'], client, '{"resources": []}');
        (0, vitest_1.expect)(result.exitCode).toBe(1);
        const parsed = JSON.parse(result.output);
        (0, vitest_1.expect)(parsed.verdict).toBe('fail');
    });
});
//# sourceMappingURL=index.test.js.map