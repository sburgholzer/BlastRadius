/**
 * Threshold evaluator for pass/fail verdict logic.
 *
 * Accepts a risk threshold (0-100) and a set of scored resources,
 * then determines whether the analysis passes or fails based on
 * whether any resource exceeds the threshold.
 *
 * Validates: Requirements 7.2, 7.5, 7.6, 7.7
 */

import type { ScoredResource } from '../models/scored-resource';

/** A resource that exceeded the risk threshold. */
export interface ExceedingResource {
  resourceId: string;
  resourceType: string;
  impactScore: number;
  riskCategory: string;
  dependencyChain: string[];
}

/** Verdict result when analysis passes (no resource exceeds threshold). */
export interface PassVerdict {
  verdict: 'pass';
  exitCode: 0;
  summary: {
    totalAffected: number;
    highestScore: number;
  };
}

/** Verdict result when analysis fails (at least one resource exceeds threshold). */
export interface FailVerdict {
  verdict: 'fail';
  exitCode: 1;
  exceedingResources: ExceedingResource[];
  summary: {
    totalAffected: number;
    highestScore: number;
    exceedingCount: number;
  };
}

/** Error result when threshold parameter is invalid. */
export interface ThresholdValidationError {
  verdict: 'error';
  exitCode: 2;
  message: string;
}

/** Union type for all possible verdict outcomes. */
export type VerdictResult = PassVerdict | FailVerdict | ThresholdValidationError;

/**
 * Validates that a threshold value is a valid integer in the range [0, 100].
 *
 * @param threshold - The threshold value to validate
 * @returns An error message if invalid, or null if valid
 */
export function validateThreshold(threshold: unknown): string | null {
  if (threshold === null || threshold === undefined) {
    return 'Risk threshold is required. Valid range: integer 0-100.';
  }

  if (typeof threshold !== 'number') {
    return `Risk threshold must be an integer in the range 0-100. Received: ${typeof threshold}.`;
  }

  if (!Number.isFinite(threshold)) {
    return 'Risk threshold must be a finite integer in the range 0-100.';
  }

  if (!Number.isInteger(threshold)) {
    return `Risk threshold must be an integer in the range 0-100. Received non-integer: ${threshold}.`;
  }

  if (threshold < 0 || threshold > 100) {
    return `Risk threshold must be in the range 0-100. Received: ${threshold}.`;
  }

  return null;
}

/**
 * Evaluates scored resources against a risk threshold to produce a pass/fail verdict.
 *
 * - Returns "pass" with exit code 0 if no resource exceeds the threshold.
 * - Returns "fail" with exit code 1 if any resource exceeds the threshold.
 * - Returns "error" with exit code 2 if the threshold parameter is invalid.
 *
 * @param scoredResources - The set of scored resources from the analysis
 * @param threshold - The risk threshold (integer, 0-100)
 * @returns A VerdictResult indicating pass, fail, or error
 */
export function evaluateThreshold(
  scoredResources: ScoredResource[],
  threshold: unknown
): VerdictResult {
  const validationError = validateThreshold(threshold);
  if (validationError !== null) {
    return {
      verdict: 'error',
      exitCode: 2,
      message: validationError,
    };
  }

  // At this point threshold is a valid integer 0-100
  const validThreshold = threshold as number;

  const totalAffected = scoredResources.length;
  const highestScore =
    scoredResources.length > 0
      ? Math.max(...scoredResources.map((r) => r.impactScore))
      : 0;

  const exceeding = scoredResources.filter(
    (r) => r.impactScore > validThreshold
  );

  if (exceeding.length > 0) {
    return {
      verdict: 'fail',
      exitCode: 1,
      exceedingResources: exceeding.map((r) => ({
        resourceId: r.resourceId,
        resourceType: r.resourceType,
        impactScore: r.impactScore,
        riskCategory: r.riskCategory,
        dependencyChain: r.dependencyChain,
      })),
      summary: {
        totalAffected,
        highestScore,
        exceedingCount: exceeding.length,
      },
    };
  }

  return {
    verdict: 'pass',
    exitCode: 0,
    summary: {
      totalAffected,
      highestScore,
    },
  };
}
