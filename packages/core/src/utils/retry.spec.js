"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const retry_1 = require("./retry");
(0, vitest_1.describe)('computeBackoffDelay', () => {
    (0, vitest_1.it)('computes delay as baseDelay * 2^attempt', () => {
        (0, vitest_1.expect)((0, retry_1.computeBackoffDelay)(0, 1000, 30000)).toBe(1000);
        (0, vitest_1.expect)((0, retry_1.computeBackoffDelay)(1, 1000, 30000)).toBe(2000);
        (0, vitest_1.expect)((0, retry_1.computeBackoffDelay)(2, 1000, 30000)).toBe(4000);
        (0, vitest_1.expect)((0, retry_1.computeBackoffDelay)(3, 1000, 30000)).toBe(8000);
    });
    (0, vitest_1.it)('caps delay at maxDelayMs', () => {
        (0, vitest_1.expect)((0, retry_1.computeBackoffDelay)(10, 1000, 30000)).toBe(30000);
        (0, vitest_1.expect)((0, retry_1.computeBackoffDelay)(5, 2000, 10000)).toBe(10000);
    });
    (0, vitest_1.it)('works with custom base delay', () => {
        (0, vitest_1.expect)((0, retry_1.computeBackoffDelay)(0, 500, 30000)).toBe(500);
        (0, vitest_1.expect)((0, retry_1.computeBackoffDelay)(1, 500, 30000)).toBe(1000);
        (0, vitest_1.expect)((0, retry_1.computeBackoffDelay)(2, 500, 30000)).toBe(2000);
    });
});
(0, vitest_1.describe)('isRetryableError', () => {
    (0, vitest_1.it)('returns true for retryable error codes', () => {
        for (const code of retry_1.RETRYABLE_ERROR_CODES) {
            const error = new Error('test');
            error.code = code;
            (0, vitest_1.expect)((0, retry_1.isRetryableError)(error)).toBe(true);
        }
    });
    (0, vitest_1.it)('returns true for retryable error names', () => {
        const error = new Error('test');
        error.name = 'ThrottlingException';
        (0, vitest_1.expect)((0, retry_1.isRetryableError)(error)).toBe(true);
    });
    (0, vitest_1.it)('returns false for non-retryable error codes', () => {
        for (const code of retry_1.NON_RETRYABLE_ERROR_CODES) {
            const error = new Error('test');
            error.code = code;
            (0, vitest_1.expect)((0, retry_1.isRetryableError)(error)).toBe(false);
        }
    });
    (0, vitest_1.it)('returns false for non-retryable error names', () => {
        const error = new Error('test');
        error.name = 'AccessDeniedException';
        (0, vitest_1.expect)((0, retry_1.isRetryableError)(error)).toBe(false);
    });
    (0, vitest_1.it)('returns false for unknown errors', () => {
        const error = new Error('something unknown');
        (0, vitest_1.expect)((0, retry_1.isRetryableError)(error)).toBe(false);
    });
    (0, vitest_1.it)('returns false for non-Error values', () => {
        (0, vitest_1.expect)((0, retry_1.isRetryableError)('string error')).toBe(false);
        (0, vitest_1.expect)((0, retry_1.isRetryableError)(null)).toBe(false);
        (0, vitest_1.expect)((0, retry_1.isRetryableError)(undefined)).toBe(false);
    });
    (0, vitest_1.it)('supports additional retryable error codes', () => {
        const error = new Error('test');
        error.code = 'CustomRetryable';
        (0, vitest_1.expect)((0, retry_1.isRetryableError)(error)).toBe(false);
        (0, vitest_1.expect)((0, retry_1.isRetryableError)(error, ['CustomRetryable'])).toBe(true);
    });
    (0, vitest_1.it)('recognizes AWS SDK v3 style Code property', () => {
        const error = new Error('test');
        error.Code = 'ThrottlingException';
        (0, vitest_1.expect)((0, retry_1.isRetryableError)(error)).toBe(true);
    });
});
(0, vitest_1.describe)('withRetry', () => {
    // Use fake timers to avoid actual delays in tests
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.useFakeTimers();
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.it)('returns success on first attempt when function succeeds', async () => {
        const fn = vitest_1.vi.fn().mockResolvedValue('result');
        const promise = (0, retry_1.withRetry)(fn);
        const result = await promise;
        (0, vitest_1.expect)(result).toEqual({
            success: true,
            result: 'result',
            attempts: 1,
        });
        (0, vitest_1.expect)(fn).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('retries on retryable errors and succeeds', async () => {
        const throttleError = new Error('throttled');
        throttleError.code = 'ThrottlingException';
        const fn = vitest_1.vi
            .fn()
            .mockRejectedValueOnce(throttleError)
            .mockResolvedValue('success');
        const promise = (0, retry_1.withRetry)(fn, { baseDelayMs: 100, maxDelayMs: 1000 });
        // Advance past the first backoff delay
        await vitest_1.vi.advanceTimersByTimeAsync(100);
        const result = await promise;
        (0, vitest_1.expect)(result).toEqual({
            success: true,
            result: 'success',
            attempts: 2,
        });
        (0, vitest_1.expect)(fn).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.it)('fails immediately on non-retryable errors', async () => {
        const accessError = new Error('denied');
        accessError.name = 'AccessDeniedException';
        const fn = vitest_1.vi.fn().mockRejectedValue(accessError);
        const result = await (0, retry_1.withRetry)(fn);
        (0, vitest_1.expect)(result).toEqual({
            success: false,
            error: accessError,
            attempts: 1,
        });
        (0, vitest_1.expect)(fn).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('exhausts all retries on persistent retryable errors', async () => {
        const networkError = new Error('timeout');
        networkError.code = 'ETIMEDOUT';
        const fn = vitest_1.vi.fn().mockRejectedValue(networkError);
        const promise = (0, retry_1.withRetry)(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 });
        // Advance through all backoff delays: 100ms, 200ms, 400ms
        await vitest_1.vi.advanceTimersByTimeAsync(100);
        await vitest_1.vi.advanceTimersByTimeAsync(200);
        await vitest_1.vi.advanceTimersByTimeAsync(400);
        const result = await promise;
        (0, vitest_1.expect)(result).toEqual({
            success: false,
            error: networkError,
            attempts: 4, // 1 initial + 3 retries
        });
        (0, vitest_1.expect)(fn).toHaveBeenCalledTimes(4);
    });
    (0, vitest_1.it)('uses default options when none provided', async () => {
        const throttleError = new Error('throttled');
        throttleError.code = 'ThrottlingException';
        const fn = vitest_1.vi.fn().mockRejectedValue(throttleError);
        const promise = (0, retry_1.withRetry)(fn);
        // Default: 3 retries, 1000ms base delay
        // Delays: 1000, 2000, 4000
        await vitest_1.vi.advanceTimersByTimeAsync(1000);
        await vitest_1.vi.advanceTimersByTimeAsync(2000);
        await vitest_1.vi.advanceTimersByTimeAsync(4000);
        const result = await promise;
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.attempts).toBe(4);
        (0, vitest_1.expect)(fn).toHaveBeenCalledTimes(4);
    });
    (0, vitest_1.it)('succeeds on the last retry attempt', async () => {
        const networkError = new Error('reset');
        networkError.code = 'ECONNRESET';
        const fn = vitest_1.vi
            .fn()
            .mockRejectedValueOnce(networkError)
            .mockRejectedValueOnce(networkError)
            .mockRejectedValueOnce(networkError)
            .mockResolvedValue('finally');
        const promise = (0, retry_1.withRetry)(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 });
        await vitest_1.vi.advanceTimersByTimeAsync(100);
        await vitest_1.vi.advanceTimersByTimeAsync(200);
        await vitest_1.vi.advanceTimersByTimeAsync(400);
        const result = await promise;
        (0, vitest_1.expect)(result).toEqual({
            success: true,
            result: 'finally',
            attempts: 4,
        });
    });
    (0, vitest_1.it)('wraps non-Error thrown values in an Error', async () => {
        const fn = vitest_1.vi.fn().mockRejectedValue('string error');
        const result = await (0, retry_1.withRetry)(fn, { maxRetries: 0 });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.error).toBeInstanceOf(Error);
        (0, vitest_1.expect)(result.error?.message).toBe('string error');
        (0, vitest_1.expect)(result.attempts).toBe(1);
    });
    (0, vitest_1.it)('respects custom retryableErrors option', async () => {
        const customError = new Error('custom');
        customError.code = 'MyCustomError';
        const fn = vitest_1.vi
            .fn()
            .mockRejectedValueOnce(customError)
            .mockResolvedValue('ok');
        const promise = (0, retry_1.withRetry)(fn, {
            baseDelayMs: 100,
            maxDelayMs: 1000,
            retryableErrors: ['MyCustomError'],
        });
        await vitest_1.vi.advanceTimersByTimeAsync(100);
        const result = await promise;
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.attempts).toBe(2);
    });
    (0, vitest_1.it)('respects maxRetries of 0 (no retries)', async () => {
        const throttleError = new Error('throttled');
        throttleError.code = 'ThrottlingException';
        const fn = vitest_1.vi.fn().mockRejectedValue(throttleError);
        const result = await (0, retry_1.withRetry)(fn, { maxRetries: 0 });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.attempts).toBe(1);
        (0, vitest_1.expect)(fn).toHaveBeenCalledTimes(1);
    });
});
//# sourceMappingURL=retry.spec.js.map