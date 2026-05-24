/**
 * Unit and property-based tests for threshold evaluator pass/fail verdict logic.
 *
 * Validates: Requirements 7.2, 7.5, 7.6, 7.7
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { evaluateThreshold, validateThreshold } from './threshold-evaluator';
import type { ScoredResource } from '../models/scored-resource';
import type { RiskCategory, CriticalityClassification } from '../models/scored-resource';

// --- Helper ---

function makeScoredResource(overrides: Partial<ScoredResource> = {}): ScoredResource {
  return {
    resourceId: 'r-001',
    resourceType: 'aws_instance',
    provider: 'aws',
    region: 'us-east-1',
    accountId: '123456789012',
    impactScore: 50,
    riskCategory: 'High',
    dependencyChain: ['root', 'r-001'],
    dependencyDepth: 1,
    criticalityClassification: 'High',
    changeTypeSeverity: 80,
    highestRiskPath: [],
    ...overrides,
  };
}

// --- validateThreshold tests ---

describe('validateThreshold', () => {
  it('should return null for valid thresholds', () => {
    expect(validateThreshold(0)).toBeNull();
    expect(validateThreshold(50)).toBeNull();
    expect(validateThreshold(100)).toBeNull();
  });

  it('should return error for null threshold', () => {
    const result = validateThreshold(null);
    expect(result).not.toBeNull();
    expect(result).toContain('required');
  });

  it('should return error for undefined threshold', () => {
    const result = validateThreshold(undefined);
    expect(result).not.toBeNull();
    expect(result).toContain('required');
  });

  it('should return error for non-number threshold', () => {
    expect(validateThreshold('50')).not.toBeNull();
    expect(validateThreshold(true)).not.toBeNull();
    expect(validateThreshold({})).not.toBeNull();
    expect(validateThreshold([])).not.toBeNull();
  });

  it('should return error for non-integer threshold', () => {
    const result = validateThreshold(50.5);
    expect(result).not.toBeNull();
    expect(result).toContain('non-integer');
  });

  it('should return error for threshold below 0', () => {
    const result = validateThreshold(-1);
    expect(result).not.toBeNull();
    expect(result).toContain('0-100');
  });

  it('should return error for threshold above 100', () => {
    const result = validateThreshold(101);
    expect(result).not.toBeNull();
    expect(result).toContain('0-100');
  });

  it('should return error for NaN', () => {
    const result = validateThreshold(NaN);
    expect(result).not.toBeNull();
  });

  it('should return error for Infinity', () => {
    const result = validateThreshold(Infinity);
    expect(result).not.toBeNull();
  });
});

// --- evaluateThreshold tests ---

describe('evaluateThreshold', () => {
  describe('pass verdict', () => {
    it('should return pass when no resources exceed threshold', () => {
      const resources = [
        makeScoredResource({ impactScore: 40 }),
        makeScoredResource({ impactScore: 50 }),
      ];

      const result = evaluateThreshold(resources, 50);

      expect(result.verdict).toBe('pass');
      expect(result.exitCode).toBe(0);
      if (result.verdict === 'pass') {
        expect(result.summary.totalAffected).toBe(2);
        expect(result.summary.highestScore).toBe(50);
      }
    });

    it('should return pass when resources equal threshold exactly', () => {
      const resources = [makeScoredResource({ impactScore: 75 })];

      const result = evaluateThreshold(resources, 75);

      expect(result.verdict).toBe('pass');
      expect(result.exitCode).toBe(0);
    });

    it('should return pass with empty resources', () => {
      const result = evaluateThreshold([], 50);

      expect(result.verdict).toBe('pass');
      expect(result.exitCode).toBe(0);
      if (result.verdict === 'pass') {
        expect(result.summary.totalAffected).toBe(0);
        expect(result.summary.highestScore).toBe(0);
      }
    });

    it('should return pass with threshold 100 and max score 100', () => {
      const resources = [makeScoredResource({ impactScore: 100 })];

      const result = evaluateThreshold(resources, 100);

      expect(result.verdict).toBe('pass');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('fail verdict', () => {
    it('should return fail when a resource exceeds threshold', () => {
      const resources = [
        makeScoredResource({ resourceId: 'r-001', impactScore: 80 }),
        makeScoredResource({ resourceId: 'r-002', impactScore: 40 }),
      ];

      const result = evaluateThreshold(resources, 75);

      expect(result.verdict).toBe('fail');
      expect(result.exitCode).toBe(1);
      if (result.verdict === 'fail') {
        expect(result.exceedingResources).toHaveLength(1);
        expect(result.exceedingResources[0].resourceId).toBe('r-001');
        expect(result.exceedingResources[0].impactScore).toBe(80);
        expect(result.summary.totalAffected).toBe(2);
        expect(result.summary.highestScore).toBe(80);
        expect(result.summary.exceedingCount).toBe(1);
      }
    });

    it('should return fail with all exceeding resources listed', () => {
      const resources = [
        makeScoredResource({ resourceId: 'r-001', impactScore: 90 }),
        makeScoredResource({ resourceId: 'r-002', impactScore: 85 }),
        makeScoredResource({ resourceId: 'r-003', impactScore: 30 }),
      ];

      const result = evaluateThreshold(resources, 50);

      expect(result.verdict).toBe('fail');
      if (result.verdict === 'fail') {
        expect(result.exceedingResources).toHaveLength(2);
        expect(result.exceedingResources.map((r) => r.resourceId)).toContain('r-001');
        expect(result.exceedingResources.map((r) => r.resourceId)).toContain('r-002');
      }
    });

    it('should include dependency chains in exceeding resources', () => {
      const chain = ['root', 'mid', 'r-001'];
      const resources = [
        makeScoredResource({ resourceId: 'r-001', impactScore: 80, dependencyChain: chain }),
      ];

      const result = evaluateThreshold(resources, 50);

      expect(result.verdict).toBe('fail');
      if (result.verdict === 'fail') {
        expect(result.exceedingResources[0].dependencyChain).toEqual(chain);
      }
    });

    it('should fail when threshold is 0 and any resource has score > 0', () => {
      const resources = [makeScoredResource({ impactScore: 1 })];

      const result = evaluateThreshold(resources, 0);

      expect(result.verdict).toBe('fail');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('error verdict', () => {
    it('should return error for invalid threshold', () => {
      const resources = [makeScoredResource()];

      const result = evaluateThreshold(resources, null);

      expect(result.verdict).toBe('error');
      expect(result.exitCode).toBe(2);
      if (result.verdict === 'error') {
        expect(result.message).toContain('required');
      }
    });

    it('should return error for out-of-range threshold', () => {
      const resources = [makeScoredResource()];

      const result = evaluateThreshold(resources, 150);

      expect(result.verdict).toBe('error');
      expect(result.exitCode).toBe(2);
      if (result.verdict === 'error') {
        expect(result.message).toContain('0-100');
      }
    });

    it('should return error for non-integer threshold', () => {
      const resources = [makeScoredResource()];

      const result = evaluateThreshold(resources, 50.5);

      expect(result.verdict).toBe('error');
      expect(result.exitCode).toBe(2);
    });
  });
});


// --- Property-Based Tests ---

/**
 * Property-based tests for verdict correctness.
 *
 * Feature: blast-radius-visualizer
 * Property 15: Verdict Correctness
 *
 * Validates: Requirements 7.2, 7.5, 7.6
 *
 * For any set of Impact_Scores and any valid threshold value in [0, 100]:
 * the verdict SHALL be "fail" if and only if at least one score exceeds the
 * threshold (with non-zero exit code and list of exceeding resources), and
 * "pass" otherwise (with exit code 0 and summary of total affected and highest score).
 */

// --- Custom Arbitraries / Generators ---

const RISK_CATEGORIES: RiskCategory[] = ['Critical', 'High', 'Medium', 'Low'];
const CRITICALITY_CLASSIFICATIONS: CriticalityClassification[] = ['Critical', 'High', 'Medium', 'Low'];

function arbitraryResourceId(): fc.Arbitrary<string> {
  return fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
    { minLength: 3, maxLength: 20 }
  ).map((s) => `r-${s}`);
}

function arbitraryResourceType(): fc.Arbitrary<string> {
  return fc.constantFrom(
    'aws_instance',
    'aws_security_group',
    'aws_lambda_function',
    'aws_rds_instance',
    'aws_s3_bucket',
    'aws_dynamodb_table'
  );
}

function arbitraryScoredResource(scoreArb?: fc.Arbitrary<number>): fc.Arbitrary<ScoredResource> {
  const impactScoreArb = scoreArb ?? fc.integer({ min: 0, max: 100 });

  return fc.record({
    resourceId: arbitraryResourceId(),
    resourceType: arbitraryResourceType(),
    provider: fc.constant('aws'),
    region: fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1'),
    accountId: fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 12, maxLength: 12 }),
    impactScore: impactScoreArb,
    riskCategory: fc.constantFrom(...RISK_CATEGORIES),
    dependencyChain: fc.array(arbitraryResourceId(), { minLength: 1, maxLength: 5 }),
    dependencyDepth: fc.integer({ min: 1, max: 10 }),
    criticalityClassification: fc.constantFrom(...CRITICALITY_CLASSIFICATIONS),
    changeTypeSeverity: fc.constantFrom(100, 80, 50),
    highestRiskPath: fc.array(
      fc.record({
        sourceId: arbitraryResourceId(),
        targetId: arbitraryResourceId(),
        relationshipType: fc.constantFrom('is_attached_to', 'references', 'is_contained_in'),
        depth: fc.integer({ min: 1, max: 10 }),
      }),
      { minLength: 0, maxLength: 3 }
    ),
  });
}

function arbitraryValidThreshold(): fc.Arbitrary<number> {
  return fc.integer({ min: 0, max: 100 });
}

describe('Feature: blast-radius-visualizer, Property 15: Verdict Correctness', () => {
  /**
   * **Validates: Requirements 7.2, 7.5, 7.6**
   *
   * The verdict is "fail" with exit code 1 if and only if at least one
   * resource's impactScore exceeds the threshold.
   */
  it('verdict is "fail" iff at least one score exceeds threshold', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 30 }),
        arbitraryValidThreshold(),
        (resources, threshold) => {
          const result = evaluateThreshold(resources, threshold);

          const exceeding = resources.filter((r) => r.impactScore > threshold);
          const shouldFail = exceeding.length > 0;

          if (shouldFail) {
            expect(result.verdict).toBe('fail');
            expect(result.exitCode).toBe(1);
          } else {
            expect(result.verdict).toBe('pass');
            expect(result.exitCode).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.2, 7.5, 7.6**
   *
   * When the verdict is "fail", the exceedingResources list contains exactly
   * the resources whose impactScore exceeds the threshold.
   */
  it('fail verdict lists exactly the resources exceeding the threshold', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryScoredResource(), { minLength: 1, maxLength: 30 }),
        arbitraryValidThreshold(),
        (resources, threshold) => {
          const result = evaluateThreshold(resources, threshold);

          const expectedExceeding = resources.filter((r) => r.impactScore > threshold);

          if (expectedExceeding.length > 0) {
            expect(result.verdict).toBe('fail');
            if (result.verdict === 'fail') {
              expect(result.exceedingResources).toHaveLength(expectedExceeding.length);

              const exceedingIds = result.exceedingResources.map((r) => r.resourceId).sort();
              const expectedIds = expectedExceeding.map((r) => r.resourceId).sort();
              expect(exceedingIds).toEqual(expectedIds);

              // Every exceeding resource must have impactScore > threshold
              for (const er of result.exceedingResources) {
                expect(er.impactScore).toBeGreaterThan(threshold);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.2, 7.5, 7.6**
   *
   * When the verdict is "pass", exit code is 0 and summary includes
   * totalAffected (count of all resources) and highestScore.
   */
  it('pass verdict has exit code 0 with correct summary', () => {
    fc.assert(
      fc.property(
        arbitraryValidThreshold(),
        fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 30 }),
        (threshold, resources) => {
          // Constrain all scores to be at or below threshold for guaranteed pass
          const constrainedResources = resources.map((r) => ({
            ...r,
            impactScore: Math.min(r.impactScore, threshold),
          }));

          const result = evaluateThreshold(constrainedResources, threshold);

          expect(result.verdict).toBe('pass');
          expect(result.exitCode).toBe(0);

          if (result.verdict === 'pass') {
            expect(result.summary.totalAffected).toBe(constrainedResources.length);

            const expectedHighest =
              constrainedResources.length > 0
                ? Math.max(...constrainedResources.map((r) => r.impactScore))
                : 0;
            expect(result.summary.highestScore).toBe(expectedHighest);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.2, 7.5, 7.6**
   *
   * When the verdict is "fail", the summary includes totalAffected,
   * highestScore, and exceedingCount matching the exceeding resources list.
   */
  it('fail verdict summary includes correct totalAffected, highestScore, and exceedingCount', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryScoredResource(fc.integer({ min: 1, max: 100 })), { minLength: 1, maxLength: 30 }),
        (resources) => {
          // Use threshold 0 to guarantee at least one exceeds (since scores >= 1)
          const result = evaluateThreshold(resources, 0);

          expect(result.verdict).toBe('fail');
          expect(result.exitCode).toBe(1);

          if (result.verdict === 'fail') {
            expect(result.summary.totalAffected).toBe(resources.length);
            expect(result.summary.highestScore).toBe(
              Math.max(...resources.map((r) => r.impactScore))
            );
            expect(result.summary.exceedingCount).toBe(result.exceedingResources.length);
            expect(result.summary.exceedingCount).toBe(
              resources.filter((r) => r.impactScore > 0).length
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.2, 7.5, 7.6**
   *
   * The boundary condition: a resource with impactScore exactly equal to the
   * threshold does NOT cause a fail verdict (only strictly exceeding does).
   */
  it('resource with score exactly equal to threshold does not cause fail', () => {
    fc.assert(
      fc.property(
        arbitraryValidThreshold(),
        arbitraryScoredResource(),
        (threshold, resource) => {
          const atThreshold = { ...resource, impactScore: threshold };
          const result = evaluateThreshold([atThreshold], threshold);

          expect(result.verdict).toBe('pass');
          expect(result.exitCode).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 16: Invalid Threshold Rejection ---

/**
 * Property-based tests for invalid threshold rejection.
 *
 * Feature: blast-radius-visualizer
 * Property 16: Invalid Threshold Rejection
 *
 * **Validates: Requirements 7.7**
 *
 * For any threshold value that is null, non-integer, or outside the range [0, 100],
 * evaluateThreshold SHALL return an error response with exit code 2 and a message
 * indicating the valid parameter range.
 */

describe('Feature: blast-radius-visualizer, Property 16: Invalid Threshold Rejection', () => {
  /**
   * **Validates: Requirements 7.7**
   *
   * Null threshold always produces error with exit code 2 and message indicating valid range.
   */
  it('null threshold returns error with exit code 2 and valid range message', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 10 }),
        (resources) => {
          const result = evaluateThreshold(resources, null);

          expect(result.verdict).toBe('error');
          expect(result.exitCode).toBe(2);
          if (result.verdict === 'error') {
            expect(result.message).toMatch(/0-100|range/i);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.7**
   *
   * Non-integer numeric thresholds (floats) produce error with exit code 2
   * and message indicating valid range.
   */
  it('non-integer threshold returns error with exit code 2 and valid range message', () => {
    const nonIntegerArb = fc.double({
      min: -1000,
      max: 1000,
      noNaN: true,
      noDefaultInfinity: true,
    }).filter((n) => !Number.isInteger(n));

    fc.assert(
      fc.property(
        nonIntegerArb,
        fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 10 }),
        (threshold, resources) => {
          const result = evaluateThreshold(resources, threshold);

          expect(result.verdict).toBe('error');
          expect(result.exitCode).toBe(2);
          if (result.verdict === 'error') {
            expect(result.message).toMatch(/0-100|range|integer/i);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.7**
   *
   * Thresholds below 0 (negative integers) produce error with exit code 2
   * and message indicating valid range.
   */
  it('threshold below 0 returns error with exit code 2 and valid range message', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10000, max: -1 }),
        fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 10 }),
        (threshold, resources) => {
          const result = evaluateThreshold(resources, threshold);

          expect(result.verdict).toBe('error');
          expect(result.exitCode).toBe(2);
          if (result.verdict === 'error') {
            expect(result.message).toMatch(/0-100|range/i);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.7**
   *
   * Thresholds above 100 (integers > 100) produce error with exit code 2
   * and message indicating valid range.
   */
  it('threshold above 100 returns error with exit code 2 and valid range message', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 101, max: 10000 }),
        fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 10 }),
        (threshold, resources) => {
          const result = evaluateThreshold(resources, threshold);

          expect(result.verdict).toBe('error');
          expect(result.exitCode).toBe(2);
          if (result.verdict === 'error') {
            expect(result.message).toMatch(/0-100|range/i);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.7**
   *
   * Non-number types (strings, booleans, objects, arrays, undefined) produce
   * error with exit code 2 and message indicating valid range.
   */
  it('non-number threshold types return error with exit code 2 and valid range message', () => {
    const nonNumberArb = fc.oneof(
      fc.string(),
      fc.boolean(),
      fc.constant(undefined),
      fc.object(),
      fc.array(fc.anything(), { maxLength: 3 })
    );

    fc.assert(
      fc.property(
        nonNumberArb,
        fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 10 }),
        (threshold, resources) => {
          const result = evaluateThreshold(resources, threshold);

          expect(result.verdict).toBe('error');
          expect(result.exitCode).toBe(2);
          if (result.verdict === 'error') {
            expect(result.message).toMatch(/0-100|range|integer/i);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
