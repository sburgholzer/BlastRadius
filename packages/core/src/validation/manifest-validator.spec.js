"use strict";
/**
 * Property-based tests for schema validation rejection with correct error paths.
 *
 * Feature: blast-radius-visualizer, Property 2: Schema Validation Rejects Invalid Manifests with Correct Error Path
 *
 * Validates: Requirements 1.2, 1.6
 *
 * For any ResourceChangeManifest containing at least one schema violation
 * (missing required field, invalid type, or invalid enum value), the Manifest
 * Ingestion Service SHALL reject the entire manifest and return an error
 * indicating the JSON path of the first violation.
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
const manifest_validator_1 = require("./manifest-validator");
// --- Helper Generators ---
/**
 * Generates a valid base manifest structure that can be mutated to introduce violations.
 */
function validBaseManifest(resourceCount = 1) {
    return {
        version: '1.0',
        metadata: {
            submittedAt: '2024-01-15T10:30:00Z',
            sourceFormat: 'terraform-plan',
        },
        resources: Array.from({ length: resourceCount }, (_, i) => ({
            resourceType: `aws_instance_${i}`,
            resourceId: `i-${String(i).padStart(10, '0')}`,
            provider: 'aws',
            modificationType: 'Modify',
        })),
    };
}
/**
 * Generates a valid resource change object.
 */
function arbitraryValidResource() {
    return fc.record({
        resourceType: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')), {
            minLength: 3,
            maxLength: 30,
        }),
        resourceId: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), {
            minLength: 3,
            maxLength: 40,
        }),
        provider: fc.constantFrom('aws', 'azure', 'gcp'),
        modificationType: fc.constantFrom('Add', 'Modify', 'Remove', 'Replace'),
    });
}
/**
 * Generates a random index within a given array length.
 */
function arbitraryIndex(maxExclusive) {
    return fc.integer({ min: 0, max: maxExclusive - 1 });
}
/**
 * Generates an invalid modification type (not one of Add, Modify, Remove, Replace).
 */
function arbitraryInvalidModificationType() {
    return fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
        minLength: 2,
        maxLength: 15,
    }).filter((s) => !['add', 'modify', 'remove', 'replace'].includes(s.toLowerCase()));
}
// --- Property Tests ---
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 2: Schema Validation Rejects Invalid Manifests with Correct Error Path', () => {
    /**
     * **Validates: Requirements 1.2, 1.6**
     *
     * Missing required field: resourceType
     * Should reject with path pointing to the violating resource.
     */
    (0, vitest_1.it)('should reject manifests with missing resourceType and return correct error path', () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 9 }), (resourceCount, targetIdx) => {
            const idx = Math.min(targetIdx, resourceCount - 1);
            const manifest = validBaseManifest(resourceCount);
            // Remove resourceType from the target resource
            const violatingResource = manifest.resources[idx];
            delete violatingResource.resourceType;
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.path).toBeDefined();
                (0, vitest_1.expect)(result.path).toContain(`resources[${idx}]`);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 1.2, 1.6**
     *
     * Missing required field: resourceId
     * Should reject with path pointing to the violating resource.
     */
    (0, vitest_1.it)('should reject manifests with missing resourceId and return correct error path', () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 9 }), (resourceCount, targetIdx) => {
            const idx = Math.min(targetIdx, resourceCount - 1);
            const manifest = validBaseManifest(resourceCount);
            const violatingResource = manifest.resources[idx];
            delete violatingResource.resourceId;
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.path).toBeDefined();
                (0, vitest_1.expect)(result.path).toContain(`resources[${idx}]`);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 1.2, 1.6**
     *
     * Missing required field: provider
     * Should reject with path pointing to the violating resource.
     */
    (0, vitest_1.it)('should reject manifests with missing provider and return correct error path', () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 9 }), (resourceCount, targetIdx) => {
            const idx = Math.min(targetIdx, resourceCount - 1);
            const manifest = validBaseManifest(resourceCount);
            const violatingResource = manifest.resources[idx];
            delete violatingResource.provider;
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.path).toBeDefined();
                (0, vitest_1.expect)(result.path).toContain(`resources[${idx}]`);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 1.2, 1.6**
     *
     * Missing required field: modificationType
     * Should reject with path pointing to the violating resource.
     */
    (0, vitest_1.it)('should reject manifests with missing modificationType and return correct error path', () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 9 }), (resourceCount, targetIdx) => {
            const idx = Math.min(targetIdx, resourceCount - 1);
            const manifest = validBaseManifest(resourceCount);
            const violatingResource = manifest.resources[idx];
            delete violatingResource.modificationType;
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.path).toBeDefined();
                (0, vitest_1.expect)(result.path).toContain(`resources[${idx}]`);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 1.2, 1.6**
     *
     * Invalid modification type (not one of Add, Modify, Remove, Replace)
     * Should reject with path pointing to the violating resource.
     */
    (0, vitest_1.it)('should reject manifests with invalid modificationType and return correct error path', () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 9 }), arbitraryInvalidModificationType(), (resourceCount, targetIdx, invalidType) => {
            const idx = Math.min(targetIdx, resourceCount - 1);
            const manifest = validBaseManifest(resourceCount);
            manifest.resources[idx].modificationType = invalidType;
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.path).toBeDefined();
                (0, vitest_1.expect)(result.path).toContain(`resources[${idx}]`);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 1.2, 1.6**
     *
     * Empty string for required fields should reject with path.
     */
    (0, vitest_1.it)('should reject manifests with empty string resourceType and return correct error path', () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 9 }), (resourceCount, targetIdx) => {
            const idx = Math.min(targetIdx, resourceCount - 1);
            const manifest = validBaseManifest(resourceCount);
            manifest.resources[idx].resourceType = '';
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.path).toBeDefined();
                (0, vitest_1.expect)(result.path).toContain(`resources[${idx}]`);
            }
        }), { numRuns: 100 });
    });
    (0, vitest_1.it)('should reject manifests with empty string resourceId and return correct error path', () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 9 }), (resourceCount, targetIdx) => {
            const idx = Math.min(targetIdx, resourceCount - 1);
            const manifest = validBaseManifest(resourceCount);
            manifest.resources[idx].resourceId = '';
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.path).toBeDefined();
                (0, vitest_1.expect)(result.path).toContain(`resources[${idx}]`);
            }
        }), { numRuns: 100 });
    });
    (0, vitest_1.it)('should reject manifests with empty string provider and return correct error path', () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 9 }), (resourceCount, targetIdx) => {
            const idx = Math.min(targetIdx, resourceCount - 1);
            const manifest = validBaseManifest(resourceCount);
            manifest.resources[idx].provider = '';
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.path).toBeDefined();
                (0, vitest_1.expect)(result.path).toContain(`resources[${idx}]`);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 1.2, 1.6**
     *
     * Exceeding 200 resources should reject with appropriate error.
     */
    (0, vitest_1.it)('should reject manifests exceeding 200 resources', () => {
        fc.assert(fc.property(fc.integer({ min: 201, max: 250 }), (resourceCount) => {
            const manifest = validBaseManifest(resourceCount);
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error).toContain('200');
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 1.2, 1.6**
     *
     * Exceeding 10 MB payload should reject with size error.
     */
    (0, vitest_1.it)('should reject manifests exceeding 10 MB payload size', () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: 3 }), (extraMB) => {
            // Create a manifest with a large properties field that exceeds 10 MB
            // 10 MB = 10 * 1024 * 1024 = 10,485,760 bytes
            // We need the JSON-serialized form to exceed this limit
            const manifest = validBaseManifest(1);
            const largeString = 'x'.repeat(5 * 1024 * 1024 + extraMB * 1024 * 1024);
            manifest.resources[0].properties = {
                before: { data: largeString },
                after: { data: largeString },
            };
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error.toLowerCase()).toContain('size');
                (0, vitest_1.expect)(result.error).toContain('10 MB');
            }
        }), { numRuns: 5 } // fewer runs due to large memory allocation
        );
    });
    /**
     * **Validates: Requirements 1.2, 1.6**
     *
     * Atomic validation: the entire manifest is rejected when any single resource
     * has a violation, even if other resources are valid.
     */
    (0, vitest_1.it)('should reject the entire manifest when only one resource has a violation among valid ones', () => {
        fc.assert(fc.property(fc.integer({ min: 2, max: 20 }), fc.constantFrom('resourceType', 'resourceId', 'provider', 'modificationType'), (resourceCount, fieldToRemove) => {
            const manifest = validBaseManifest(resourceCount);
            // Pick a random resource to violate (always the last one for determinism)
            const violatingIdx = resourceCount - 1;
            const violatingResource = manifest.resources[violatingIdx];
            delete violatingResource[fieldToRemove];
            const result = (0, manifest_validator_1.validateManifest)(manifest);
            // Entire manifest must be rejected
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.path).toBeDefined();
                (0, vitest_1.expect)(result.path).toContain(`resources[${violatingIdx}]`);
            }
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=manifest-validator.spec.js.map