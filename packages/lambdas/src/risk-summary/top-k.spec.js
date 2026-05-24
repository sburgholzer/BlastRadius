"use strict";
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
const handler_1 = require("./handler");
/**
 * Property-based tests for Top-K Risk Selection for Summary.
 *
 * Feature: blast-radius-visualizer
 * Property 17: Top-K Risk Selection for Summary
 *
 * **Validates: Requirements 8.2**
 *
 * For any set of scored resources, the Risk Summary Generator input selection
 * SHALL include exactly the top 3 highest-scoring resources (or all resources
 * if fewer than 3 exist), ordered by Impact_Score descending.
 */
// --- Custom Arbitraries / Generators ---
const riskCategories = ['Critical', 'High', 'Medium', 'Low'];
const criticalityClassifications = [
    'Critical',
    'High',
    'Medium',
    'Low',
];
function arbitraryScoredResource() {
    return fc.record({
        resourceId: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
            minLength: 5,
            maxLength: 20,
        }),
        resourceType: fc.constantFrom('aws_rds_instance', 'aws_lambda_function', 'aws_ec2_instance', 'aws_s3_bucket', 'aws_dynamodb_table', 'aws_security_group', 'aws_iam_role'),
        provider: fc.constant('aws'),
        region: fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'),
        accountId: fc.stringOf(fc.constantFrom(...'0123456789'.split('')), {
            minLength: 12,
            maxLength: 12,
        }),
        impactScore: fc.integer({ min: 0, max: 100 }),
        riskCategory: fc.constantFrom(...riskCategories),
        dependencyChain: fc.array(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
            minLength: 3,
            maxLength: 15,
        }), { minLength: 1, maxLength: 5 }),
        dependencyDepth: fc.integer({ min: 1, max: 10 }),
        criticalityClassification: fc.constantFrom(...criticalityClassifications),
        changeTypeSeverity: fc.constantFrom(50, 80, 100),
        highestRiskPath: fc.array(fc.record({
            sourceId: fc.string({ minLength: 3, maxLength: 10 }),
            targetId: fc.string({ minLength: 3, maxLength: 10 }),
            relationshipType: fc.constantFrom('references', 'is_attached_to', 'is_contained_in'),
            depth: fc.integer({ min: 1, max: 10 }),
        }), { minLength: 0, maxLength: 3 }),
    });
}
function arbitraryScoredResources(minLength = 0, maxLength = 20) {
    return fc.array(arbitraryScoredResource(), { minLength, maxLength });
}
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 17: Top-K Risk Selection for Summary', () => {
    /**
     * **Validates: Requirements 8.2**
     *
     * Returns exactly top 3 resources when input has 3 or more resources,
     * or all resources when fewer than 3 exist.
     */
    (0, vitest_1.it)('returns exactly min(3, n) resources where n is the input length', () => {
        fc.assert(fc.property(arbitraryScoredResources(0, 20), (resources) => {
            const result = (0, handler_1.selectTopResources)(resources);
            const expectedLength = Math.min(3, resources.length);
            (0, vitest_1.expect)(result).toHaveLength(expectedLength);
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 8.2**
     *
     * The returned resources are ordered by impactScore in descending order.
     */
    (0, vitest_1.it)('returns resources ordered by impactScore descending', () => {
        fc.assert(fc.property(arbitraryScoredResources(1, 20), (resources) => {
            const result = (0, handler_1.selectTopResources)(resources);
            for (let i = 0; i < result.length - 1; i++) {
                (0, vitest_1.expect)(result[i].impactScore).toBeGreaterThanOrEqual(result[i + 1].impactScore);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 8.2**
     *
     * Every resource in the result has an impactScore >= every resource NOT in the result.
     * This confirms the selection truly picks the top-scoring resources.
     */
    (0, vitest_1.it)('selected resources have scores >= all non-selected resources', () => {
        fc.assert(fc.property(arbitraryScoredResources(4, 20), (resources) => {
            const result = (0, handler_1.selectTopResources)(resources);
            const resultIds = new Set(result.map((r) => r.resourceId));
            const nonSelected = resources.filter((r) => !resultIds.has(r.resourceId));
            const minSelectedScore = Math.min(...result.map((r) => r.impactScore));
            for (const excluded of nonSelected) {
                (0, vitest_1.expect)(excluded.impactScore).toBeLessThanOrEqual(minSelectedScore);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 8.2**
     *
     * When fewer than 3 resources exist, all resources are returned.
     */
    (0, vitest_1.it)('returns all resources when input has fewer than 3', () => {
        fc.assert(fc.property(arbitraryScoredResources(0, 2), (resources) => {
            const result = (0, handler_1.selectTopResources)(resources);
            (0, vitest_1.expect)(result).toHaveLength(resources.length);
            // All input resources should be present in the result
            const resultIds = new Set(result.map((r) => r.resourceId));
            for (const r of resources) {
                (0, vitest_1.expect)(resultIds.has(r.resourceId)).toBe(true);
            }
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=top-k.spec.js.map