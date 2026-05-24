"use strict";
/**
 * Unit tests for the Risk Summary Generator Lambda handler.
 *
 * Tests cover:
 * - Top-K resource selection (Requirement 8.2)
 * - Word limit enforcement (Requirement 8.1)
 * - Feature flag behavior (Requirement 8.5)
 * - Graceful failure handling (Requirement 8.4)
 * - Prompt construction
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const handler_1 = require("./handler");
function makeScoredResource(overrides = {}) {
    return {
        resourceId: overrides.resourceId ?? 'res-1',
        resourceType: overrides.resourceType ?? 'AWS::EC2::Instance',
        provider: 'aws',
        region: 'us-east-1',
        accountId: '123456789012',
        impactScore: overrides.impactScore ?? 50,
        riskCategory: overrides.riskCategory ?? 'High',
        dependencyChain: overrides.dependencyChain ?? ['src-1', 'res-1'],
        dependencyDepth: overrides.dependencyDepth ?? 1,
        criticalityClassification: overrides.criticalityClassification ?? 'High',
        changeTypeSeverity: overrides.changeTypeSeverity ?? 80,
        highestRiskPath: overrides.highestRiskPath ?? [],
    };
}
const emptyGraph = { nodes: [], edges: [] };
const defaultRiskSummary = {
    critical: 1,
    high: 2,
    medium: 3,
    low: 4,
    totalAffected: 10,
    highestScore: 95,
};
(0, vitest_1.describe)('selectTopResources', () => {
    (0, vitest_1.it)('returns top 3 resources sorted by impactScore descending', () => {
        const resources = [
            makeScoredResource({ resourceId: 'a', impactScore: 30 }),
            makeScoredResource({ resourceId: 'b', impactScore: 90 }),
            makeScoredResource({ resourceId: 'c', impactScore: 60 }),
            makeScoredResource({ resourceId: 'd', impactScore: 75 }),
            makeScoredResource({ resourceId: 'e', impactScore: 45 }),
        ];
        const result = (0, handler_1.selectTopResources)(resources, 3);
        (0, vitest_1.expect)(result).toHaveLength(3);
        (0, vitest_1.expect)(result[0].resourceId).toBe('b');
        (0, vitest_1.expect)(result[1].resourceId).toBe('d');
        (0, vitest_1.expect)(result[2].resourceId).toBe('c');
    });
    (0, vitest_1.it)('returns all resources if fewer than k exist', () => {
        const resources = [
            makeScoredResource({ resourceId: 'a', impactScore: 80 }),
            makeScoredResource({ resourceId: 'b', impactScore: 50 }),
        ];
        const result = (0, handler_1.selectTopResources)(resources, 3);
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result[0].resourceId).toBe('a');
        (0, vitest_1.expect)(result[1].resourceId).toBe('b');
    });
    (0, vitest_1.it)('returns empty array for empty input', () => {
        const result = (0, handler_1.selectTopResources)([], 3);
        (0, vitest_1.expect)(result).toHaveLength(0);
    });
    (0, vitest_1.it)('returns exactly 1 resource when k=1', () => {
        const resources = [
            makeScoredResource({ resourceId: 'a', impactScore: 30 }),
            makeScoredResource({ resourceId: 'b', impactScore: 90 }),
        ];
        const result = (0, handler_1.selectTopResources)(resources, 1);
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].resourceId).toBe('b');
    });
    (0, vitest_1.it)('does not mutate the original array', () => {
        const resources = [
            makeScoredResource({ resourceId: 'a', impactScore: 30 }),
            makeScoredResource({ resourceId: 'b', impactScore: 90 }),
        ];
        const originalOrder = resources.map((r) => r.resourceId);
        (0, handler_1.selectTopResources)(resources, 3);
        (0, vitest_1.expect)(resources.map((r) => r.resourceId)).toEqual(originalOrder);
    });
});
(0, vitest_1.describe)('enforceWordLimit', () => {
    (0, vitest_1.it)('returns text unchanged if within limit', () => {
        const text = 'This is a short summary with only a few words.';
        (0, vitest_1.expect)((0, handler_1.enforceWordLimit)(text, 500)).toBe(text);
    });
    (0, vitest_1.it)('truncates text exceeding the word limit at sentence boundary', () => {
        const words = Array.from({ length: 600 }, (_, i) => `word${i}`);
        // Insert sentence endings
        words[100] = 'end.';
        words[400] = 'boundary.';
        const text = words.join(' ');
        const result = (0, handler_1.enforceWordLimit)(text, 500);
        const resultWords = result.split(/\s+/).filter((w) => w.length > 0);
        (0, vitest_1.expect)(resultWords.length).toBeLessThanOrEqual(500);
        (0, vitest_1.expect)(result.endsWith('.')).toBe(true);
    });
    (0, vitest_1.it)('truncates at word limit if no sentence boundary found', () => {
        const words = Array.from({ length: 600 }, (_, i) => `word${i}`);
        const text = words.join(' ');
        const result = (0, handler_1.enforceWordLimit)(text, 500);
        const resultWords = result.split(/\s+/).filter((w) => w.length > 0);
        (0, vitest_1.expect)(resultWords.length).toBe(500);
    });
    (0, vitest_1.it)('handles empty string', () => {
        (0, vitest_1.expect)((0, handler_1.enforceWordLimit)('', 500)).toBe('');
    });
    (0, vitest_1.it)('handles exactly 500 words', () => {
        const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
        const text = words.join(' ');
        const result = (0, handler_1.enforceWordLimit)(text, 500);
        (0, vitest_1.expect)(result).toBe(text);
    });
});
(0, vitest_1.describe)('buildPrompt', () => {
    (0, vitest_1.it)('includes resource details in the prompt', () => {
        const resources = [
            makeScoredResource({
                resourceId: 'sg-123',
                resourceType: 'AWS::EC2::SecurityGroup',
                impactScore: 85,
                riskCategory: 'Critical',
            }),
        ];
        const prompt = (0, handler_1.buildPrompt)(resources, defaultRiskSummary);
        (0, vitest_1.expect)(prompt).toContain('AWS::EC2::SecurityGroup');
        (0, vitest_1.expect)(prompt).toContain('sg-123');
        (0, vitest_1.expect)(prompt).toContain('85/100');
        (0, vitest_1.expect)(prompt).toContain('Critical risk');
        (0, vitest_1.expect)(prompt).toContain('500 words');
    });
    (0, vitest_1.it)('includes risk summary totals', () => {
        const prompt = (0, handler_1.buildPrompt)([makeScoredResource()], defaultRiskSummary);
        (0, vitest_1.expect)(prompt).toContain('Total affected resources: 10');
        (0, vitest_1.expect)(prompt).toContain('Critical: 1');
        (0, vitest_1.expect)(prompt).toContain('High: 2');
        (0, vitest_1.expect)(prompt).toContain('Highest impact score: 95/100');
    });
});
(0, vitest_1.describe)('handler', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.stubEnv('ENABLE_BEDROCK_SUMMARY', '');
        vitest_1.vi.stubEnv('BEDROCK_MODEL_ID', '');
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.unstubAllEnvs();
    });
    (0, vitest_1.it)('skips summary generation when feature flag is disabled', async () => {
        vitest_1.vi.stubEnv('ENABLE_BEDROCK_SUMMARY', 'false');
        const result = await (0, handler_1.handler)({
            scoredResources: [makeScoredResource()],
            riskSummary: defaultRiskSummary,
            dependencyGraph: emptyGraph,
            enableSummary: false,
        });
        (0, vitest_1.expect)(result.skipped).toBe(true);
        (0, vitest_1.expect)(result.summary).toBeUndefined();
        (0, vitest_1.expect)(result.generationDurationMs).toBeGreaterThanOrEqual(0);
    });
    (0, vitest_1.it)('skips when enableSummary input is explicitly false', async () => {
        const result = await (0, handler_1.handler)({
            scoredResources: [makeScoredResource()],
            riskSummary: defaultRiskSummary,
            dependencyGraph: emptyGraph,
            enableSummary: false,
        });
        (0, vitest_1.expect)(result.skipped).toBe(true);
        (0, vitest_1.expect)(result.summary).toBeUndefined();
    });
    (0, vitest_1.it)('returns empty blast radius message when no scored resources', async () => {
        const result = await (0, handler_1.handler)({
            scoredResources: [],
            riskSummary: { critical: 0, high: 0, medium: 0, low: 0, totalAffected: 0, highestScore: 0 },
            dependencyGraph: emptyGraph,
            enableSummary: true,
        });
        (0, vitest_1.expect)(result.skipped).toBe(false);
        (0, vitest_1.expect)(result.summary).toContain('No resources were affected');
    });
    (0, vitest_1.it)('returns gracefully with error on Bedrock failure', async () => {
        // With enableSummary=true and resources present, it will try to call Bedrock
        // which will fail since we're not in AWS — this tests graceful degradation
        vitest_1.vi.stubEnv('ENABLE_BEDROCK_SUMMARY', 'true');
        const result = await (0, handler_1.handler)({
            scoredResources: [makeScoredResource({ impactScore: 90 })],
            riskSummary: defaultRiskSummary,
            dependencyGraph: emptyGraph,
            enableSummary: true,
        });
        (0, vitest_1.expect)(result.skipped).toBe(false);
        (0, vitest_1.expect)(result.summary).toBeUndefined();
        (0, vitest_1.expect)(result.error).toBeDefined();
        (0, vitest_1.expect)(result.generationDurationMs).toBeGreaterThanOrEqual(0);
    });
    (0, vitest_1.it)('uses environment variable feature flag when enableSummary not provided', async () => {
        vitest_1.vi.stubEnv('ENABLE_BEDROCK_SUMMARY', 'false');
        const result = await (0, handler_1.handler)({
            scoredResources: [makeScoredResource()],
            riskSummary: defaultRiskSummary,
            dependencyGraph: emptyGraph,
        });
        // enableSummary not provided, env var is 'false', so isFeatureEnabled() returns false
        (0, vitest_1.expect)(result.skipped).toBe(true);
    });
    (0, vitest_1.it)('enables summary when env var is "true"', async () => {
        vitest_1.vi.stubEnv('ENABLE_BEDROCK_SUMMARY', 'true');
        const result = await (0, handler_1.handler)({
            scoredResources: [makeScoredResource()],
            riskSummary: defaultRiskSummary,
            dependencyGraph: emptyGraph,
        });
        // Will attempt Bedrock call and fail gracefully in test env
        (0, vitest_1.expect)(result.skipped).toBe(false);
    });
    (0, vitest_1.it)('enables summary when env var is "1"', async () => {
        vitest_1.vi.stubEnv('ENABLE_BEDROCK_SUMMARY', '1');
        const result = await (0, handler_1.handler)({
            scoredResources: [makeScoredResource()],
            riskSummary: defaultRiskSummary,
            dependencyGraph: emptyGraph,
        });
        (0, vitest_1.expect)(result.skipped).toBe(false);
    });
});
//# sourceMappingURL=handler.test.js.map