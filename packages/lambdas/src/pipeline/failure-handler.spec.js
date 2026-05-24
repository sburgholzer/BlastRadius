"use strict";
/**
 * Unit tests for the Pipeline Failure Handler.
 *
 * Validates: Requirements 5.3, 5.7
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const failure_handler_1 = require("./failure-handler");
// ─── Mock Factory ────────────────────────────────────────────────────────────
function createMockDeps() {
    const s3Calls = [];
    const dynamoCalls = [];
    const s3Client = {
        send: vitest_1.vi.fn().mockImplementation((command) => {
            const cmd = command;
            s3Calls.push(cmd.input);
            return Promise.resolve({});
        }),
    };
    const docClient = {
        send: vitest_1.vi.fn().mockImplementation((command) => {
            const cmd = command;
            dynamoCalls.push(cmd.input);
            return Promise.resolve({});
        }),
    };
    return {
        s3Client: s3Client,
        docClient: docClient,
        s3Calls,
        dynamoCalls,
    };
}
function createValidInput(overrides) {
    return {
        analysisId: 'analysis-123',
        requestingPrincipal: 'arn:aws:iam::123456789012:user/test',
        originatingAccountId: '123456789012',
        sourceFormat: 'cloudformation',
        submittedAt: '2024-01-15T10:30:00Z',
        completedStages: ['Ingestion', 'Discovery'],
        failedStage: 'Scoring',
        error: {
            message: 'Service throttling: rate limit exceeded',
            category: 'SERVICE_THROTTLING',
        },
        ...overrides,
    };
}
// ─── Tests ───────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('Pipeline Failure Handler', () => {
    (0, vitest_1.describe)('successful failure handling', () => {
        (0, vitest_1.it)('stores partial results in S3 and updates DynamoDB status', async () => {
            const deps = createMockDeps();
            const input = createValidInput();
            const result = await (0, failure_handler_1.handler)(input, deps);
            (0, vitest_1.expect)(result).toEqual({
                success: true,
                analysisId: 'analysis-123',
                resultLocation: 's3://blast-radius-results/results/analysis-123/analysis-result.json',
                failedStage: 'Scoring',
                errorCategory: 'SERVICE_THROTTLING',
            });
            // Verify S3 was called
            (0, vitest_1.expect)(deps.s3Calls).toHaveLength(1);
            (0, vitest_1.expect)(deps.s3Calls[0].Bucket).toBe('blast-radius-results');
            (0, vitest_1.expect)(deps.s3Calls[0].Key).toBe('results/analysis-123/analysis-result.json');
            // Verify the stored JSON contains expected fields
            const storedResult = JSON.parse(deps.s3Calls[0].Body);
            (0, vitest_1.expect)(storedResult.analysisId).toBe('analysis-123');
            (0, vitest_1.expect)(storedResult.status).toBe('failed');
            (0, vitest_1.expect)(storedResult.completedStages).toEqual(['Ingestion', 'Discovery']);
            (0, vitest_1.expect)(storedResult.failedStage).toBe('Scoring');
            (0, vitest_1.expect)(storedResult.errorDetails).toEqual({
                stage: 'Scoring',
                errorCategory: 'SERVICE_THROTTLING',
                message: 'Service throttling: rate limit exceeded',
            });
            // Verify DynamoDB was called
            (0, vitest_1.expect)(deps.dynamoCalls).toHaveLength(1);
        });
        (0, vitest_1.it)('includes partial results when provided', async () => {
            const deps = createMockDeps();
            const input = createValidInput({
                partialResults: {
                    manifest: {
                        version: '1.0',
                        metadata: { submittedAt: '2024-01-15T10:30:00Z', sourceFormat: 'cloudformation' },
                        resources: [
                            {
                                resourceType: 'AWS::EC2::Instance',
                                resourceId: 'i-12345',
                                provider: 'aws',
                                modificationType: 'Modify',
                            },
                        ],
                    },
                    stageDurations: { Ingestion: 1200, Discovery: 5400 },
                },
            });
            const result = await (0, failure_handler_1.handler)(input, deps);
            (0, vitest_1.expect)(result).toHaveProperty('success', true);
            const storedResult = JSON.parse(deps.s3Calls[0].Body);
            (0, vitest_1.expect)(storedResult.manifest).toBeDefined();
            (0, vitest_1.expect)(storedResult.manifest.resources).toHaveLength(1);
            (0, vitest_1.expect)(storedResult.stageDurations).toEqual({ Ingestion: 1200, Discovery: 5400 });
        });
        (0, vitest_1.it)('records error details with category and message', async () => {
            const deps = createMockDeps();
            const input = createValidInput({
                failedStage: 'Discovery',
                error: {
                    message: 'Permission denied: insufficient IAM permissions',
                    category: 'PERMISSION_DENIED',
                },
            });
            await (0, failure_handler_1.handler)(input, deps);
            const storedResult = JSON.parse(deps.s3Calls[0].Body);
            (0, vitest_1.expect)(storedResult.errorDetails).toEqual({
                stage: 'Discovery',
                errorCategory: 'PERMISSION_DENIED',
                message: 'Permission denied: insufficient IAM permissions',
            });
        });
        (0, vitest_1.it)('sets completedAt timestamp on the stored result', async () => {
            const deps = createMockDeps();
            const input = createValidInput();
            await (0, failure_handler_1.handler)(input, deps);
            const storedResult = JSON.parse(deps.s3Calls[0].Body);
            (0, vitest_1.expect)(storedResult.completedAt).toBeDefined();
            // Should be a valid ISO date string
            (0, vitest_1.expect)(new Date(storedResult.completedAt).toISOString()).toBe(storedResult.completedAt);
        });
    });
    (0, vitest_1.describe)('input validation', () => {
        (0, vitest_1.it)('rejects null input', async () => {
            const deps = createMockDeps();
            const result = await (0, failure_handler_1.handler)(null, deps);
            (0, vitest_1.expect)(result).toEqual({ error: 'Invalid input: expected an object', statusCode: 400 });
        });
        (0, vitest_1.it)('rejects missing analysisId', async () => {
            const deps = createMockDeps();
            const input = createValidInput({ analysisId: '' });
            const result = await (0, failure_handler_1.handler)(input, deps);
            (0, vitest_1.expect)(result).toEqual({ error: 'Missing or invalid "analysisId" field', statusCode: 400 });
        });
        (0, vitest_1.it)('rejects missing requestingPrincipal', async () => {
            const deps = createMockDeps();
            const input = createValidInput({ requestingPrincipal: '' });
            const result = await (0, failure_handler_1.handler)(input, deps);
            (0, vitest_1.expect)(result).toEqual({ error: 'Missing or invalid "requestingPrincipal" field', statusCode: 400 });
        });
        (0, vitest_1.it)('rejects missing failedStage', async () => {
            const deps = createMockDeps();
            const input = createValidInput({ failedStage: '' });
            const result = await (0, failure_handler_1.handler)(input, deps);
            (0, vitest_1.expect)(result).toEqual({ error: 'Missing or invalid "failedStage" field', statusCode: 400 });
        });
        (0, vitest_1.it)('rejects missing error object', async () => {
            const deps = createMockDeps();
            const input = createValidInput({ error: undefined });
            const result = await (0, failure_handler_1.handler)(input, deps);
            (0, vitest_1.expect)(result).toEqual({ error: 'Missing or invalid "error" field', statusCode: 400 });
        });
        (0, vitest_1.it)('rejects non-array completedStages', async () => {
            const deps = createMockDeps();
            const input = createValidInput({ completedStages: 'Ingestion' });
            const result = await (0, failure_handler_1.handler)(input, deps);
            (0, vitest_1.expect)(result).toEqual({ error: 'Missing or invalid "completedStages" field: must be an array', statusCode: 400 });
        });
    });
    (0, vitest_1.describe)('error classification', () => {
        (0, vitest_1.it)('classifies error from message when category is not provided', async () => {
            const deps = createMockDeps();
            const input = createValidInput({
                error: {
                    message: 'Rate limit exceeded for AWS Config API',
                    category: undefined,
                },
            });
            const result = await (0, failure_handler_1.handler)(input, deps);
            (0, vitest_1.expect)(result).toHaveProperty('success', true);
            (0, vitest_1.expect)(result).toHaveProperty('errorCategory', 'SERVICE_THROTTLING');
        });
    });
    (0, vitest_1.describe)('error handling', () => {
        (0, vitest_1.it)('returns 500 error when S3 put fails', async () => {
            const deps = createMockDeps();
            deps.s3Client.send.mockRejectedValueOnce(new Error('S3 service unavailable'));
            const input = createValidInput();
            const result = await (0, failure_handler_1.handler)(input, deps);
            (0, vitest_1.expect)(result).toEqual({
                error: 'Failed to store failure results: S3 service unavailable',
                statusCode: 500,
            });
        });
        (0, vitest_1.it)('returns 500 error when DynamoDB update fails', async () => {
            const deps = createMockDeps();
            deps.docClient.send.mockRejectedValueOnce(new Error('DynamoDB service unavailable'));
            const input = createValidInput();
            const result = await (0, failure_handler_1.handler)(input, deps);
            (0, vitest_1.expect)(result).toEqual({
                error: 'Failed to store failure results: DynamoDB service unavailable',
                statusCode: 500,
            });
        });
    });
    (0, vitest_1.describe)('isNonRetryable', () => {
        (0, vitest_1.it)('returns true for VALIDATION_ERROR', () => {
            (0, vitest_1.expect)((0, failure_handler_1.isNonRetryable)('VALIDATION_ERROR')).toBe(true);
        });
        (0, vitest_1.it)('returns true for PERMISSION_DENIED', () => {
            (0, vitest_1.expect)((0, failure_handler_1.isNonRetryable)('PERMISSION_DENIED')).toBe(true);
        });
        (0, vitest_1.it)('returns true for RESOURCE_NOT_FOUND', () => {
            (0, vitest_1.expect)((0, failure_handler_1.isNonRetryable)('RESOURCE_NOT_FOUND')).toBe(true);
        });
        (0, vitest_1.it)('returns false for SERVICE_THROTTLING', () => {
            (0, vitest_1.expect)((0, failure_handler_1.isNonRetryable)('SERVICE_THROTTLING')).toBe(false);
        });
        (0, vitest_1.it)('returns false for TRANSIENT_NETWORK', () => {
            (0, vitest_1.expect)((0, failure_handler_1.isNonRetryable)('TRANSIENT_NETWORK')).toBe(false);
        });
        (0, vitest_1.it)('returns false for INTERNAL_ERROR', () => {
            (0, vitest_1.expect)((0, failure_handler_1.isNonRetryable)('INTERNAL_ERROR')).toBe(false);
        });
        (0, vitest_1.it)('returns false for TIMEOUT', () => {
            (0, vitest_1.expect)((0, failure_handler_1.isNonRetryable)('TIMEOUT')).toBe(false);
        });
        (0, vitest_1.it)('returns false for UNKNOWN', () => {
            (0, vitest_1.expect)((0, failure_handler_1.isNonRetryable)('UNKNOWN')).toBe(false);
        });
    });
});
//# sourceMappingURL=failure-handler.spec.js.map