/**
 * Unit tests for the Pipeline Failure Handler.
 *
 * Validates: Requirements 5.3, 5.7
 */

import { describe, it, expect, vi } from 'vitest';
import { handler, isNonRetryable } from './failure-handler';
import type { FailureHandlerInput, FailureHandlerDeps, ErrorCategory } from './failure-handler';

// ─── Mock Factory ────────────────────────────────────────────────────────────

function createMockDeps(): FailureHandlerDeps & {
  s3Calls: Array<{ Bucket: string; Key: string; Body: string }>;
  dynamoCalls: Array<Record<string, unknown>>;
} {
  const s3Calls: Array<{ Bucket: string; Key: string; Body: string }> = [];
  const dynamoCalls: Array<Record<string, unknown>> = [];

  const s3Client = {
    send: vi.fn().mockImplementation((command: unknown) => {
      const cmd = command as { input: { Bucket: string; Key: string; Body: string } };
      s3Calls.push(cmd.input);
      return Promise.resolve({});
    }),
  };

  const docClient = {
    send: vi.fn().mockImplementation((command: unknown) => {
      const cmd = command as { input: Record<string, unknown> };
      dynamoCalls.push(cmd.input);
      return Promise.resolve({});
    }),
  };

  return {
    s3Client: s3Client as unknown as FailureHandlerDeps['s3Client'],
    docClient: docClient as unknown as FailureHandlerDeps['docClient'],
    s3Calls,
    dynamoCalls,
  };
}

function createValidInput(overrides?: Partial<FailureHandlerInput>): FailureHandlerInput {
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

describe('Pipeline Failure Handler', () => {
  describe('successful failure handling', () => {
    it('stores partial results in S3 and updates DynamoDB status', async () => {
      const deps = createMockDeps();
      const input = createValidInput();

      const result = await handler(input, deps);

      expect(result).toEqual({
        success: true,
        analysisId: 'analysis-123',
        resultLocation: 's3://blast-radius-results/results/analysis-123/analysis-result.json',
        failedStage: 'Scoring',
        errorCategory: 'SERVICE_THROTTLING',
      });

      // Verify S3 was called
      expect(deps.s3Calls).toHaveLength(1);
      expect(deps.s3Calls[0].Bucket).toBe('blast-radius-results');
      expect(deps.s3Calls[0].Key).toBe('results/analysis-123/analysis-result.json');

      // Verify the stored JSON contains expected fields
      const storedResult = JSON.parse(deps.s3Calls[0].Body);
      expect(storedResult.analysisId).toBe('analysis-123');
      expect(storedResult.status).toBe('failed');
      expect(storedResult.completedStages).toEqual(['Ingestion', 'Discovery']);
      expect(storedResult.failedStage).toBe('Scoring');
      expect(storedResult.errorDetails).toEqual({
        stage: 'Scoring',
        errorCategory: 'SERVICE_THROTTLING',
        message: 'Service throttling: rate limit exceeded',
      });

      // Verify DynamoDB was called
      expect(deps.dynamoCalls).toHaveLength(1);
    });

    it('includes partial results when provided', async () => {
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

      const result = await handler(input, deps);

      expect(result).toHaveProperty('success', true);

      const storedResult = JSON.parse(deps.s3Calls[0].Body);
      expect(storedResult.manifest).toBeDefined();
      expect(storedResult.manifest.resources).toHaveLength(1);
      expect(storedResult.stageDurations).toEqual({ Ingestion: 1200, Discovery: 5400 });
    });

    it('records error details with category and message', async () => {
      const deps = createMockDeps();
      const input = createValidInput({
        failedStage: 'Discovery',
        error: {
          message: 'Permission denied: insufficient IAM permissions',
          category: 'PERMISSION_DENIED',
        },
      });

      await handler(input, deps);

      const storedResult = JSON.parse(deps.s3Calls[0].Body);
      expect(storedResult.errorDetails).toEqual({
        stage: 'Discovery',
        errorCategory: 'PERMISSION_DENIED',
        message: 'Permission denied: insufficient IAM permissions',
      });
    });

    it('sets completedAt timestamp on the stored result', async () => {
      const deps = createMockDeps();
      const input = createValidInput();

      await handler(input, deps);

      const storedResult = JSON.parse(deps.s3Calls[0].Body);
      expect(storedResult.completedAt).toBeDefined();
      // Should be a valid ISO date string
      expect(new Date(storedResult.completedAt).toISOString()).toBe(storedResult.completedAt);
    });
  });

  describe('input validation', () => {
    it('rejects null input', async () => {
      const deps = createMockDeps();
      const result = await handler(null as unknown as FailureHandlerInput, deps);
      expect(result).toEqual({ error: 'Invalid input: expected an object', statusCode: 400 });
    });

    it('rejects missing analysisId', async () => {
      const deps = createMockDeps();
      const input = createValidInput({ analysisId: '' });
      const result = await handler(input, deps);
      expect(result).toEqual({ error: 'Missing or invalid "analysisId" field', statusCode: 400 });
    });

    it('rejects missing requestingPrincipal', async () => {
      const deps = createMockDeps();
      const input = createValidInput({ requestingPrincipal: '' });
      const result = await handler(input, deps);
      expect(result).toEqual({ error: 'Missing or invalid "requestingPrincipal" field', statusCode: 400 });
    });

    it('rejects missing failedStage', async () => {
      const deps = createMockDeps();
      const input = createValidInput({ failedStage: '' });
      const result = await handler(input, deps);
      expect(result).toEqual({ error: 'Missing or invalid "failedStage" field', statusCode: 400 });
    });

    it('rejects missing error object', async () => {
      const deps = createMockDeps();
      const input = createValidInput({ error: undefined as unknown as FailureHandlerInput['error'] });
      const result = await handler(input, deps);
      expect(result).toEqual({ error: 'Missing or invalid "error" field', statusCode: 400 });
    });

    it('rejects non-array completedStages', async () => {
      const deps = createMockDeps();
      const input = createValidInput({ completedStages: 'Ingestion' as unknown as string[] });
      const result = await handler(input, deps);
      expect(result).toEqual({ error: 'Missing or invalid "completedStages" field: must be an array', statusCode: 400 });
    });
  });

  describe('error classification', () => {
    it('classifies error from message when category is not provided', async () => {
      const deps = createMockDeps();
      const input = createValidInput({
        error: {
          message: 'Rate limit exceeded for AWS Config API',
          category: undefined as unknown as ErrorCategory,
        },
      });

      const result = await handler(input, deps);

      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('errorCategory', 'SERVICE_THROTTLING');
    });
  });

  describe('error handling', () => {
    it('returns 500 error when S3 put fails', async () => {
      const deps = createMockDeps();
      (deps.s3Client.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('S3 service unavailable'),
      );

      const input = createValidInput();
      const result = await handler(input, deps);

      expect(result).toEqual({
        error: 'Failed to store failure results: S3 service unavailable',
        statusCode: 500,
      });
    });

    it('returns 500 error when DynamoDB update fails', async () => {
      const deps = createMockDeps();
      (deps.docClient.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('DynamoDB service unavailable'),
      );

      const input = createValidInput();
      const result = await handler(input, deps);

      expect(result).toEqual({
        error: 'Failed to store failure results: DynamoDB service unavailable',
        statusCode: 500,
      });
    });
  });

  describe('isNonRetryable', () => {
    it('returns true for VALIDATION_ERROR', () => {
      expect(isNonRetryable('VALIDATION_ERROR')).toBe(true);
    });

    it('returns true for PERMISSION_DENIED', () => {
      expect(isNonRetryable('PERMISSION_DENIED')).toBe(true);
    });

    it('returns true for RESOURCE_NOT_FOUND', () => {
      expect(isNonRetryable('RESOURCE_NOT_FOUND')).toBe(true);
    });

    it('returns false for SERVICE_THROTTLING', () => {
      expect(isNonRetryable('SERVICE_THROTTLING')).toBe(false);
    });

    it('returns false for TRANSIENT_NETWORK', () => {
      expect(isNonRetryable('TRANSIENT_NETWORK')).toBe(false);
    });

    it('returns false for INTERNAL_ERROR', () => {
      expect(isNonRetryable('INTERNAL_ERROR')).toBe(false);
    });

    it('returns false for TIMEOUT', () => {
      expect(isNonRetryable('TIMEOUT')).toBe(false);
    });

    it('returns false for UNKNOWN', () => {
      expect(isNonRetryable('UNKNOWN')).toBe(false);
    });
  });
});
