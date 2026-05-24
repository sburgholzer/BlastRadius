/**
 * Retry utility with exponential backoff for AWS service calls.
 *
 * Retries transient/throttling errors up to a configurable number of times
 * with exponential backoff. Non-retryable errors (validation, access denied,
 * resource not found) fail immediately without retry.
 *
 * On persistent failure after all retries, callers should mark affected
 * resources as having unknown dependency coverage and continue processing.
 *
 * @module utils/retry
 * @see Requirement 3.7
 */

/** Default error codes/names considered retryable (transient or throttling). */
export const RETRYABLE_ERROR_CODES: ReadonlyArray<string> = [
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceUnavailableException',
  'InternalServerError',
  'RequestTimeout',
  'NetworkingError',
  'ECONNRESET',
  'ETIMEDOUT',
];

/** Error codes/names that should never be retried. */
export const NON_RETRYABLE_ERROR_CODES: ReadonlyArray<string> = [
  'ValidationException',
  'AccessDeniedException',
  'ResourceNotFoundException',
  'InvalidParameterValue',
];

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000). */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds (default: 30000). */
  maxDelayMs?: number;
  /** Additional error codes/names to treat as retryable. */
  retryableErrors?: string[];
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
}

/**
 * Determines whether an error is retryable based on its code or name.
 */
export function isRetryableError(
  error: unknown,
  additionalRetryable: string[] = []
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const errorCode = getErrorCode(error);
  const errorName = error.name;

  const retryableCodes = [...RETRYABLE_ERROR_CODES, ...additionalRetryable];

  // Check if the error code or name matches any retryable pattern
  for (const code of retryableCodes) {
    if (errorCode === code || errorName === code) {
      return true;
    }
  }

  // Explicitly non-retryable errors should never be retried
  for (const code of NON_RETRYABLE_ERROR_CODES) {
    if (errorCode === code || errorName === code) {
      return false;
    }
  }

  return false;
}

/**
 * Computes the delay for a given attempt using exponential backoff.
 * delay = min(baseDelay * 2^attempt, maxDelay)
 *
 * Attempt 0: baseDelay (1s default)
 * Attempt 1: baseDelay * 2 (2s default)
 * Attempt 2: baseDelay * 4 (4s default)
 */
export function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const delay = baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, maxDelayMs);
}

/**
 * Executes an async function with retry logic and exponential backoff.
 *
 * Retries on retryable errors (throttling, transient network issues).
 * Fails immediately on non-retryable errors (validation, access denied).
 * On persistent failure after all retries, returns a failed result so callers
 * can mark resources as unknown coverage and continue.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<RetryResult<T>> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const maxDelayMs = options?.maxDelayMs ?? 30000;
  const additionalRetryable = options?.retryableErrors ?? [];

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return {
        success: true,
        result,
        attempts: attempt + 1,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If this is the first attempt or a retry, check if we should retry
      if (attempt < maxRetries) {
        if (!isRetryableError(error, additionalRetryable)) {
          // Non-retryable error: fail immediately
          return {
            success: false,
            error: lastError,
            attempts: attempt + 1,
          };
        }

        // Wait with exponential backoff before retrying
        const delay = computeBackoffDelay(attempt, baseDelayMs, maxDelayMs);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  return {
    success: false,
    error: lastError,
    attempts: maxRetries + 1,
  };
}

/**
 * Extracts an error code from an error object.
 * AWS SDK errors typically have a `code` property.
 */
function getErrorCode(error: Error): string | undefined {
  // AWS SDK v2 style
  if ('code' in error && typeof (error as Record<string, unknown>).code === 'string') {
    return (error as Record<string, unknown>).code as string;
  }
  // AWS SDK v3 style
  if ('Code' in error && typeof (error as Record<string, unknown>).Code === 'string') {
    return (error as Record<string, unknown>).Code as string;
  }
  return undefined;
}

/** Promise-based sleep utility. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
