"use strict";
/**
 * Property-based tests for Resource Change Manifest validation.
 *
 * Feature: blast-radius-visualizer
 * Property 1: Schema Validation Accepts All Valid Manifests
 *
 * Validates: Requirements 1.1, 1.3
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
const manifest_validator_1 = require("../validation/manifest-validator");
// --- Custom Arbitraries / Generators ---
/**
 * Generates a valid ModificationType value.
 */
function arbitraryModificationType() {
    return fc.constantFrom('Add', 'Modify', 'Remove', 'Replace');
}
/**
 * Generates a valid provider string (e.g., "aws", "azure", "gcp").
 */
function arbitraryProvider() {
    return fc.constantFrom('aws', 'azure', 'gcp');
}
/**
 * Generates a valid ResourceChange object with all required fields:
 * resourceType, resourceId, provider, and modificationType.
 */
function arbitraryResourceChange() {
    return fc.record({
        resourceType: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')), {
            minLength: 3,
            maxLength: 40,
        }),
        resourceId: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), { minLength: 3, maxLength: 60 }),
        provider: arbitraryProvider(),
        modificationType: arbitraryModificationType(),
    });
}
/**
 * Generates a valid ResourceChangeManifest with 1-200 resources.
 * Each resource conforms to the canonical schema requirements.
 *
 * @param options - Optional configuration for the generator
 * @param options.minResources - Minimum number of resources (default: 1)
 * @param options.maxResources - Maximum number of resources (default: 200)
 */
function arbitraryManifest(options) {
    const minResources = options?.minResources ?? 1;
    const maxResources = options?.maxResources ?? 200;
    return fc.record({
        version: fc.constantFrom('1.0', '1.1', '2.0'),
        metadata: fc.record({
            submittedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
            sourceFormat: fc.constantFrom('terraform-plan', 'cloudformation', 'cdk', 'pulumi', 'canonical'),
            description: fc.option(fc.string({ minLength: 0, maxLength: 100 }), { nil: undefined }),
        }),
        resources: fc.array(arbitraryResourceChange(), {
            minLength: minResources,
            maxLength: maxResources,
        }),
    });
}
// --- Property Tests ---
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 1: Schema Validation Accepts All Valid Manifests', () => {
    /**
     * **Validates: Requirements 1.1, 1.3**
     *
     * For any ResourceChangeManifest that conforms to the canonical schema
     * (contains 1-200 resources, each with resource type, resource identifier,
     * provider, and modification type), the validation should accept it without error.
     */
    (0, vitest_1.it)('should accept any valid ResourceChangeManifest without error', () => {
        fc.assert(fc.property(arbitraryManifest(), (manifest) => {
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, vitest_1.expect)(result.manifest).toEqual(manifest);
            }
        }), { numRuns: 100 });
    });
    (0, vitest_1.it)('should accept manifests at the minimum boundary (1 resource)', () => {
        fc.assert(fc.property(arbitraryManifest({ minResources: 1, maxResources: 1 }), (manifest) => {
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(true);
        }), { numRuns: 100 });
    });
    (0, vitest_1.it)('should accept manifests at the maximum boundary (200 resources)', () => {
        fc.assert(fc.property(arbitraryManifest({ minResources: 200, maxResources: 200 }), (manifest) => {
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(true);
        }), { numRuns: 20 } // fewer runs due to larger data size
        );
    });
    (0, vitest_1.it)('should accept manifests with all modification types', () => {
        fc.assert(fc.property(arbitraryManifest({ minResources: 4, maxResources: 50 }), (manifest) => {
            // Ensure the manifest has valid structure regardless of which modification types appear
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(true);
        }), { numRuns: 100 });
    });
    (0, vitest_1.it)('should accept manifests with all supported providers', () => {
        fc.assert(fc.property(arbitraryManifest({ minResources: 3, maxResources: 50 }), (manifest) => {
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(true);
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=manifest.spec.js.map