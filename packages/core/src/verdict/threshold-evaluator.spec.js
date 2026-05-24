"use strict";
/**
 * Unit and property-based tests for threshold evaluator pass/fail verdict logic.
 *
 * Validates: Requirements 7.2, 7.5, 7.6, 7.7
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fc = __importStar(require("fast-check"));
const threshold_evaluator_1 = require("./threshold-evaluator");
// --- Helper ---
function makeScoredResource(overrides = {}) {
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
(0, vitest_1.describe)('validateThreshold', () => {
    (0, vitest_1.it)('should return null for valid thresholds', () => {
        (0, vitest_1.expect)((0, threshold_evaluator_1.validateThreshold)(0)).toBeNull();
        (0, vitest_1.expect)((0, threshold_evaluator_1.validateThreshold)(50)).toBeNull();
        (0, vitest_1.expect)((0, threshold_evaluator_1.validateThreshold)(100)).toBeNull();
    });
    (0, vitest_1.it)('should return error for null threshold', () => {
        const result = (0, threshold_evaluator_1.validateThreshold)(null);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result).toContain('required');
    });
    (0, vitest_1.it)('should return error for undefined threshold', () => {
        const result = (0, threshold_evaluator_1.validateThreshold)(undefined);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result).toContain('required');
    });
    (0, vitest_1.it)('should return error for non-number threshold', () => {
        (0, vitest_1.expect)((0, threshold_evaluator_1.validateThreshold)('50')).not.toBeNull();
        (0, vitest_1.expect)((0, threshold_evaluator_1.validateThreshold)(true)).not.toBeNull();
        (0, vitest_1.expect)((0, threshold_evaluator_1.validateThreshold)({})).not.toBeNull();
        (0, vitest_1.expect)((0, threshold_evaluator_1.validateThreshold)([])).not.toBeNull();
    });
    (0, vitest_1.it)('should return error for non-integer threshold', () => {
        const result = (0, threshold_evaluator_1.validateThreshold)(50.5);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result).toContain('non-integer');
    });
    (0, vitest_1.it)('should return error for threshold below 0', () => {
        const result = (0, threshold_evaluator_1.validateThreshold)(-1);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result).toContain('0-100');
    });
    (0, vitest_1.it)('should return error for threshold above 100', () => {
        const result = (0, threshold_evaluator_1.validateThreshold)(101);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result).toContain('0-100');
    });
    (0, vitest_1.it)('should return error for NaN', () => {
        const result = (0, threshold_evaluator_1.validateThreshold)(NaN);
        (0, vitest_1.expect)(result).not.toBeNull();
    });
    (0, vitest_1.it)('should return error for Infinity', () => {
        const result = (0, threshold_evaluator_1.validateThreshold)(Infinity);
        (0, vitest_1.expect)(result).not.toBeNull();
    });
});
// --- evaluateThreshold tests ---
(0, vitest_1.describe)('evaluateThreshold', () => {
    (0, vitest_1.describe)('pass verdict', () => {
        (0, vitest_1.it)('should return pass when no resources exceed threshold', () => {
            const resources = [
                makeScoredResource({ impactScore: 40 }),
                makeScoredResource({ impactScore: 50 }),
            ];
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, 50);
            (0, vitest_1.expect)(result.verdict).toBe('pass');
            (0, vitest_1.expect)(result.exitCode).toBe(0);
            if (result.verdict === 'pass') {
                (0, vitest_1.expect)(result.summary.totalAffected).toBe(2);
                (0, vitest_1.expect)(result.summary.highestScore).toBe(50);
            }
        });
        (0, vitest_1.it)('should return pass when resources equal threshold exactly', () => {
            const resources = [makeScoredResource({ impactScore: 75 })];
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, 75);
            (0, vitest_1.expect)(result.verdict).toBe('pass');
            (0, vitest_1.expect)(result.exitCode).toBe(0);
        });
        (0, vitest_1.it)('should return pass with empty resources', () => {
            const result = (0, threshold_evaluator_1.evaluateThreshold)([], 50);
            (0, vitest_1.expect)(result.verdict).toBe('pass');
            (0, vitest_1.expect)(result.exitCode).toBe(0);
            if (result.verdict === 'pass') {
                (0, vitest_1.expect)(result.summary.totalAffected).toBe(0);
                (0, vitest_1.expect)(result.summary.highestScore).toBe(0);
            }
        });
        (0, vitest_1.it)('should return pass with threshold 100 and max score 100', () => {
            const resources = [makeScoredResource({ impactScore: 100 })];
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, 100);
            (0, vitest_1.expect)(result.verdict).toBe('pass');
            (0, vitest_1.expect)(result.exitCode).toBe(0);
        });
    });
    (0, vitest_1.describe)('fail verdict', () => {
        (0, vitest_1.it)('should return fail when a resource exceeds threshold', () => {
            const resources = [
                makeScoredResource({ resourceId: 'r-001', impactScore: 80 }),
                makeScoredResource({ resourceId: 'r-002', impactScore: 40 }),
            ];
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, 75);
            (0, vitest_1.expect)(result.verdict).toBe('fail');
            (0, vitest_1.expect)(result.exitCode).toBe(1);
            if (result.verdict === 'fail') {
                (0, vitest_1.expect)(result.exceedingResources).toHaveLength(1);
                (0, vitest_1.expect)(result.exceedingResources[0].resourceId).toBe('r-001');
                (0, vitest_1.expect)(result.exceedingResources[0].impactScore).toBe(80);
                (0, vitest_1.expect)(result.summary.totalAffected).toBe(2);
                (0, vitest_1.expect)(result.summary.highestScore).toBe(80);
                (0, vitest_1.expect)(result.summary.exceedingCount).toBe(1);
            }
        });
        (0, vitest_1.it)('should return fail with all exceeding resources listed', () => {
            const resources = [
                makeScoredResource({ resourceId: 'r-001', impactScore: 90 }),
                makeScoredResource({ resourceId: 'r-002', impactScore: 85 }),
                makeScoredResource({ resourceId: 'r-003', impactScore: 30 }),
            ];
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, 50);
            (0, vitest_1.expect)(result.verdict).toBe('fail');
            if (result.verdict === 'fail') {
                (0, vitest_1.expect)(result.exceedingResources).toHaveLength(2);
                (0, vitest_1.expect)(result.exceedingResources.map((r) => r.resourceId)).toContain('r-001');
                (0, vitest_1.expect)(result.exceedingResources.map((r) => r.resourceId)).toContain('r-002');
            }
        });
        (0, vitest_1.it)('should include dependency chains in exceeding resources', () => {
            const chain = ['root', 'mid', 'r-001'];
            const resources = [
                makeScoredResource({ resourceId: 'r-001', impactScore: 80, dependencyChain: chain }),
            ];
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, 50);
            (0, vitest_1.expect)(result.verdict).toBe('fail');
            if (result.verdict === 'fail') {
                (0, vitest_1.expect)(result.exceedingResources[0].dependencyChain).toEqual(chain);
            }
        });
        (0, vitest_1.it)('should fail when threshold is 0 and any resource has score > 0', () => {
            const resources = [makeScoredResource({ impactScore: 1 })];
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, 0);
            (0, vitest_1.expect)(result.verdict).toBe('fail');
            (0, vitest_1.expect)(result.exitCode).toBe(1);
        });
    });
    (0, vitest_1.describe)('error verdict', () => {
        (0, vitest_1.it)('should return error for invalid threshold', () => {
            const resources = [makeScoredResource()];
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, null);
            (0, vitest_1.expect)(result.verdict).toBe('error');
            (0, vitest_1.expect)(result.exitCode).toBe(2);
            if (result.verdict === 'error') {
                (0, vitest_1.expect)(result.message).toContain('required');
            }
        });
        (0, vitest_1.it)('should return error for out-of-range threshold', () => {
            const resources = [makeScoredResource()];
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, 150);
            (0, vitest_1.expect)(result.verdict).toBe('error');
            (0, vitest_1.expect)(result.exitCode).toBe(2);
            if (result.verdict === 'error') {
                (0, vitest_1.expect)(result.message).toContain('0-100');
            }
        });
        (0, vitest_1.it)('should return error for non-integer threshold', () => {
            const resources = [makeScoredResource()];
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, 50.5);
            (0, vitest_1.expect)(result.verdict).toBe('error');
            (0, vitest_1.expect)(result.exitCode).toBe(2);
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
const RISK_CATEGORIES = ['Critical', 'High', 'Medium', 'Low'];
const CRITICALITY_CLASSIFICATIONS = ['Critical', 'High', 'Medium', 'Low'];
function arbitraryResourceId() {
    return fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), { minLength: 3, maxLength: 20 }).map((s) => `r-${s}`);
}
function arbitraryResourceType() {
    return fc.constantFrom('aws_instance', 'aws_security_group', 'aws_lambda_function', 'aws_rds_instance', 'aws_s3_bucket', 'aws_dynamodb_table');
}
function arbitraryScoredResource(scoreArb) {
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
        highestRiskPath: fc.array(fc.record({
            sourceId: arbitraryResourceId(),
            targetId: arbitraryResourceId(),
            relationshipType: fc.constantFrom('is_attached_to', 'references', 'is_contained_in'),
            depth: fc.integer({ min: 1, max: 10 }),
        }), { minLength: 0, maxLength: 3 }),
    });
}
function arbitraryValidThreshold() {
    return fc.integer({ min: 0, max: 100 });
}
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 15: Verdict Correctness', () => {
    /**
     * **Validates: Requirements 7.2, 7.5, 7.6**
     *
     * The verdict is "fail" with exit code 1 if and only if at least one
     * resource's impactScore exceeds the threshold.
     */
    (0, vitest_1.it)('verdict is "fail" iff at least one score exceeds threshold', () => {
        fc.assert(fc.property(fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 30 }), arbitraryValidThreshold(), (resources, threshold) => {
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, threshold);
            const exceeding = resources.filter((r) => r.impactScore > threshold);
            const shouldFail = exceeding.length > 0;
            if (shouldFail) {
                (0, vitest_1.expect)(result.verdict).toBe('fail');
                (0, vitest_1.expect)(result.exitCode).toBe(1);
            }
            else {
                (0, vitest_1.expect)(result.verdict).toBe('pass');
                (0, vitest_1.expect)(result.exitCode).toBe(0);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 7.2, 7.5, 7.6**
     *
     * When the verdict is "fail", the exceedingResources list contains exactly
     * the resources whose impactScore exceeds the threshold.
     */
    (0, vitest_1.it)('fail verdict lists exactly the resources exceeding the threshold', () => {
        fc.assert(fc.property(fc.array(arbitraryScoredResource(), { minLength: 1, maxLength: 30 }), arbitraryValidThreshold(), (resources, threshold) => {
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, threshold);
            const expectedExceeding = resources.filter((r) => r.impactScore > threshold);
            if (expectedExceeding.length > 0) {
                (0, vitest_1.expect)(result.verdict).toBe('fail');
                if (result.verdict === 'fail') {
                    (0, vitest_1.expect)(result.exceedingResources).toHaveLength(expectedExceeding.length);
                    const exceedingIds = result.exceedingResources.map((r) => r.resourceId).sort();
                    const expectedIds = expectedExceeding.map((r) => r.resourceId).sort();
                    (0, vitest_1.expect)(exceedingIds).toEqual(expectedIds);
                    // Every exceeding resource must have impactScore > threshold
                    for (const er of result.exceedingResources) {
                        (0, vitest_1.expect)(er.impactScore).toBeGreaterThan(threshold);
                    }
                }
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 7.2, 7.5, 7.6**
     *
     * When the verdict is "pass", exit code is 0 and summary includes
     * totalAffected (count of all resources) and highestScore.
     */
    (0, vitest_1.it)('pass verdict has exit code 0 with correct summary', () => {
        fc.assert(fc.property(arbitraryValidThreshold(), fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 30 }), (threshold, resources) => {
            // Constrain all scores to be at or below threshold for guaranteed pass
            const constrainedResources = resources.map((r) => ({
                ...r,
                impactScore: Math.min(r.impactScore, threshold),
            }));
            const result = (0, threshold_evaluator_1.evaluateThreshold)(constrainedResources, threshold);
            (0, vitest_1.expect)(result.verdict).toBe('pass');
            (0, vitest_1.expect)(result.exitCode).toBe(0);
            if (result.verdict === 'pass') {
                (0, vitest_1.expect)(result.summary.totalAffected).toBe(constrainedResources.length);
                const expectedHighest = constrainedResources.length > 0
                    ? Math.max(...constrainedResources.map((r) => r.impactScore))
                    : 0;
                (0, vitest_1.expect)(result.summary.highestScore).toBe(expectedHighest);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 7.2, 7.5, 7.6**
     *
     * When the verdict is "fail", the summary includes totalAffected,
     * highestScore, and exceedingCount matching the exceeding resources list.
     */
    (0, vitest_1.it)('fail verdict summary includes correct totalAffected, highestScore, and exceedingCount', () => {
        fc.assert(fc.property(fc.array(arbitraryScoredResource(fc.integer({ min: 1, max: 100 })), { minLength: 1, maxLength: 30 }), (resources) => {
            // Use threshold 0 to guarantee at least one exceeds (since scores >= 1)
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, 0);
            (0, vitest_1.expect)(result.verdict).toBe('fail');
            (0, vitest_1.expect)(result.exitCode).toBe(1);
            if (result.verdict === 'fail') {
                (0, vitest_1.expect)(result.summary.totalAffected).toBe(resources.length);
                (0, vitest_1.expect)(result.summary.highestScore).toBe(Math.max(...resources.map((r) => r.impactScore)));
                (0, vitest_1.expect)(result.summary.exceedingCount).toBe(result.exceedingResources.length);
                (0, vitest_1.expect)(result.summary.exceedingCount).toBe(resources.filter((r) => r.impactScore > 0).length);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 7.2, 7.5, 7.6**
     *
     * The boundary condition: a resource with impactScore exactly equal to the
     * threshold does NOT cause a fail verdict (only strictly exceeding does).
     */
    (0, vitest_1.it)('resource with score exactly equal to threshold does not cause fail', () => {
        fc.assert(fc.property(arbitraryValidThreshold(), arbitraryScoredResource(), (threshold, resource) => {
            const atThreshold = { ...resource, impactScore: threshold };
            const result = (0, threshold_evaluator_1.evaluateThreshold)([atThreshold], threshold);
            (0, vitest_1.expect)(result.verdict).toBe('pass');
            (0, vitest_1.expect)(result.exitCode).toBe(0);
        }), { numRuns: 100 });
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
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 16: Invalid Threshold Rejection', () => {
    /**
     * **Validates: Requirements 7.7**
     *
     * Null threshold always produces error with exit code 2 and message indicating valid range.
     */
    (0, vitest_1.it)('null threshold returns error with exit code 2 and valid range message', () => {
        fc.assert(fc.property(fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 10 }), (resources) => {
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, null);
            (0, vitest_1.expect)(result.verdict).toBe('error');
            (0, vitest_1.expect)(result.exitCode).toBe(2);
            if (result.verdict === 'error') {
                (0, vitest_1.expect)(result.message).toMatch(/0-100|range/i);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 7.7**
     *
     * Non-integer numeric thresholds (floats) produce error with exit code 2
     * and message indicating valid range.
     */
    (0, vitest_1.it)('non-integer threshold returns error with exit code 2 and valid range message', () => {
        const nonIntegerArb = fc.double({
            min: -1000,
            max: 1000,
            noNaN: true,
            noDefaultInfinity: true,
        }).filter((n) => !Number.isInteger(n));
        fc.assert(fc.property(nonIntegerArb, fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 10 }), (threshold, resources) => {
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, threshold);
            (0, vitest_1.expect)(result.verdict).toBe('error');
            (0, vitest_1.expect)(result.exitCode).toBe(2);
            if (result.verdict === 'error') {
                (0, vitest_1.expect)(result.message).toMatch(/0-100|range|integer/i);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 7.7**
     *
     * Thresholds below 0 (negative integers) produce error with exit code 2
     * and message indicating valid range.
     */
    (0, vitest_1.it)('threshold below 0 returns error with exit code 2 and valid range message', () => {
        fc.assert(fc.property(fc.integer({ min: -10000, max: -1 }), fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 10 }), (threshold, resources) => {
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, threshold);
            (0, vitest_1.expect)(result.verdict).toBe('error');
            (0, vitest_1.expect)(result.exitCode).toBe(2);
            if (result.verdict === 'error') {
                (0, vitest_1.expect)(result.message).toMatch(/0-100|range/i);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 7.7**
     *
     * Thresholds above 100 (integers > 100) produce error with exit code 2
     * and message indicating valid range.
     */
    (0, vitest_1.it)('threshold above 100 returns error with exit code 2 and valid range message', () => {
        fc.assert(fc.property(fc.integer({ min: 101, max: 10000 }), fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 10 }), (threshold, resources) => {
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, threshold);
            (0, vitest_1.expect)(result.verdict).toBe('error');
            (0, vitest_1.expect)(result.exitCode).toBe(2);
            if (result.verdict === 'error') {
                (0, vitest_1.expect)(result.message).toMatch(/0-100|range/i);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 7.7**
     *
     * Non-number types (strings, booleans, objects, arrays, undefined) produce
     * error with exit code 2 and message indicating valid range.
     */
    (0, vitest_1.it)('non-number threshold types return error with exit code 2 and valid range message', () => {
        const nonNumberArb = fc.oneof(fc.string(), fc.boolean(), fc.constant(undefined), fc.object(), fc.array(fc.anything(), { maxLength: 3 }));
        fc.assert(fc.property(nonNumberArb, fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 10 }), (threshold, resources) => {
            const result = (0, threshold_evaluator_1.evaluateThreshold)(resources, threshold);
            (0, vitest_1.expect)(result.verdict).toBe('error');
            (0, vitest_1.expect)(result.exitCode).toBe(2);
            if (result.verdict === 'error') {
                (0, vitest_1.expect)(result.message).toMatch(/0-100|range|integer/i);
            }
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=threshold-evaluator.spec.js.map