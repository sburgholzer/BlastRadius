import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withRetry,
  isRetryableError,
  computeBackoffDelay,
  RETRYABLE_ERROR_CODES,
  NON_RETRYABLE_ERROR_CODES,
} from './retry';

describe('computeBackoffDelay', () => {
  it('computes delay as baseDelay * 2^attempt', () => {
    expect(computeBackoffDelay(0, 1000, 30000)).toBe(1000);
    expect(computeBackoffDelay(1, 1000, 30000)).toBe(2000);
    expect(computeBackoffDelay(2, 1000, 30000)).toBe(4000);
    expect(computeBackoffDelay(3, 1000, 30000)).toBe(8000);
  });

  it('caps delay at maxDelayMs', () => {
    expect(computeBackoffDelay(10, 1000, 30000)).toBe(30000);
    expect(computeBackoffDelay(5, 2000, 10000)).toBe(10000);
  });

  it('works with custom base delay', () => {
    expect(computeBackoffDelay(0, 500, 30000)).toBe(500);
    expect(computeBackoffDelay(1, 500, 30000)).toBe(1000);
    expect(computeBackoffDelay(2, 500, 30000)).toBe(2000);
  });
});

describe('isRetryableError', () => {
  it('returns true for retryable error codes', () => {
    for (const code of RETRYABLE_ERROR_CODES) {
      const error = new Error('test');
      (error as unknown as Record<string, string>).code = code;
      expect(isRetryableError(error)).toBe(true);
    }
  });

  it('returns true for retryable error names', () => {
    const error = new Error('test');
    error.name = 'ThrottlingException';
    expect(isRetryableError(error)).toBe(true);
  });

  it('returns false for non-retryable error codes', () => {
    for (const code of NON_RETRYABLE_ERROR_CODES) {
      const error = new Error('test');
      (error as unknown as Record<string, string>).code = code;
      expect(isRetryableError(error)).toBe(false);
    }
  });

  it('returns false for non-retryable error names', () => {
    const error = new Error('test');
    error.name = 'AccessDeniedException';
    expect(isRetryableError(error)).toBe(false);
  });

  it('returns false for unknown errors', () => {
    const error = new Error('something unknown');
    expect(isRetryableError(error)).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isRetryableError('string error')).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });

  it('supports additional retryable error codes', () => {
    const error = new Error('test');
    (error as unknown as Record<string, string>).code = 'CustomRetryable';
    expect(isRetryableError(error)).toBe(false);
    expect(isRetryableError(error, ['CustomRetryable'])).toBe(true);
  });

  it('recognizes AWS SDK v3 style Code property', () => {
    const error = new Error('test');
    (error as unknown as Record<string, string>).Code = 'ThrottlingException';
    expect(isRetryableError(error)).toBe(true);
  });
});

describe('withRetry', () => {
  // Use fake timers to avoid actual delays in tests
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns success on first attempt when function succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('result');

    const promise = withRetry(fn);
    const result = await promise;

    expect(result).toEqual({
      success: true,
      result: 'result',
      attempts: 1,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable errors and succeeds', async () => {
    const throttleError = new Error('throttled');
    (throttleError as unknown as Record<string, string>).code = 'ThrottlingException';

    const fn = vi
      .fn()
      .mockRejectedValueOnce(throttleError)
      .mockResolvedValue('success');

    const promise = withRetry(fn, { baseDelayMs: 100, maxDelayMs: 1000 });

    // Advance past the first backoff delay
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;

    expect(result).toEqual({
      success: true,
      result: 'success',
      attempts: 2,
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fails immediately on non-retryable errors', async () => {
    const accessError = new Error('denied');
    accessError.name = 'AccessDeniedException';

    const fn = vi.fn().mockRejectedValue(accessError);

    const result = await withRetry(fn);

    expect(result).toEqual({
      success: false,
      error: accessError,
      attempts: 1,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts all retries on persistent retryable errors', async () => {
    const networkError = new Error('timeout');
    (networkError as unknown as Record<string, string>).code = 'ETIMEDOUT';

    const fn = vi.fn().mockRejectedValue(networkError);

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 });

    // Advance through all backoff delays: 100ms, 200ms, 400ms
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(400);

    const result = await promise;

    expect(result).toEqual({
      success: false,
      error: networkError,
      attempts: 4, // 1 initial + 3 retries
    });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('uses default options when none provided', async () => {
    const throttleError = new Error('throttled');
    (throttleError as unknown as Record<string, string>).code = 'ThrottlingException';

    const fn = vi.fn().mockRejectedValue(throttleError);

    const promise = withRetry(fn);

    // Default: 3 retries, 1000ms base delay
    // Delays: 1000, 2000, 4000
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(4);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('succeeds on the last retry attempt', async () => {
    const networkError = new Error('reset');
    (networkError as unknown as Record<string, string>).code = 'ECONNRESET';

    const fn = vi
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValue('finally');

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(400);

    const result = await promise;

    expect(result).toEqual({
      success: true,
      result: 'finally',
      attempts: 4,
    });
  });

  it('wraps non-Error thrown values in an Error', async () => {
    const fn = vi.fn().mockRejectedValue('string error');

    const result = await withRetry(fn, { maxRetries: 0 });

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('string error');
    expect(result.attempts).toBe(1);
  });

  it('respects custom retryableErrors option', async () => {
    const customError = new Error('custom');
    (customError as unknown as Record<string, string>).code = 'MyCustomError';

    const fn = vi
      .fn()
      .mockRejectedValueOnce(customError)
      .mockResolvedValue('ok');

    const promise = withRetry(fn, {
      baseDelayMs: 100,
      maxDelayMs: 1000,
      retryableErrors: ['MyCustomError'],
    });

    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('respects maxRetries of 0 (no retries)', async () => {
    const throttleError = new Error('throttled');
    (throttleError as unknown as Record<string, string>).code = 'ThrottlingException';

    const fn = vi.fn().mockRejectedValue(throttleError);

    const result = await withRetry(fn, { maxRetries: 0 });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
