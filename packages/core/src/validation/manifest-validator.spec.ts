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

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateManifest } from './manifest-validator';

// --- Helper Generators ---

/**
 * Generates a valid base manifest structure that can be mutated to introduce violations.
 */
function validBaseManifest(resourceCount: number = 1) {
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
      modificationType: 'Modify' as const,
    })),
  };
}

/**
 * Generates a valid resource change object.
 */
function arbitraryValidResource(): fc.Arbitrary<Record<string, unknown>> {
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
function arbitraryIndex(maxExclusive: number): fc.Arbitrary<number> {
  return fc.integer({ min: 0, max: maxExclusive - 1 });
}

/**
 * Generates an invalid modification type (not one of Add, Modify, Remove, Replace).
 */
function arbitraryInvalidModificationType(): fc.Arbitrary<string> {
  return fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
    minLength: 2,
    maxLength: 15,
  }).filter((s) => !['add', 'modify', 'remove', 'replace'].includes(s.toLowerCase()));
}

// --- Property Tests ---

describe('Feature: blast-radius-visualizer, Property 2: Schema Validation Rejects Invalid Manifests with Correct Error Path', () => {
  /**
   * **Validates: Requirements 1.2, 1.6**
   *
   * Missing required field: resourceType
   * Should reject with path pointing to the violating resource.
   */
  it('should reject manifests with missing resourceType and return correct error path', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 9 }),
        (resourceCount, targetIdx) => {
          const idx = Math.min(targetIdx, resourceCount - 1);
          const manifest = validBaseManifest(resourceCount);

          // Remove resourceType from the target resource
          const violatingResource = manifest.resources[idx] as Record<string, unknown>;
          delete violatingResource.resourceType;

          const result = validateManifest(manifest);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.path).toBeDefined();
            expect(result.path).toContain(`resources[${idx}]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.6**
   *
   * Missing required field: resourceId
   * Should reject with path pointing to the violating resource.
   */
  it('should reject manifests with missing resourceId and return correct error path', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 9 }),
        (resourceCount, targetIdx) => {
          const idx = Math.min(targetIdx, resourceCount - 1);
          const manifest = validBaseManifest(resourceCount);

          const violatingResource = manifest.resources[idx] as Record<string, unknown>;
          delete violatingResource.resourceId;

          const result = validateManifest(manifest);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.path).toBeDefined();
            expect(result.path).toContain(`resources[${idx}]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.6**
   *
   * Missing required field: provider
   * Should reject with path pointing to the violating resource.
   */
  it('should reject manifests with missing provider and return correct error path', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 9 }),
        (resourceCount, targetIdx) => {
          const idx = Math.min(targetIdx, resourceCount - 1);
          const manifest = validBaseManifest(resourceCount);

          const violatingResource = manifest.resources[idx] as Record<string, unknown>;
          delete violatingResource.provider;

          const result = validateManifest(manifest);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.path).toBeDefined();
            expect(result.path).toContain(`resources[${idx}]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.6**
   *
   * Missing required field: modificationType
   * Should reject with path pointing to the violating resource.
   */
  it('should reject manifests with missing modificationType and return correct error path', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 9 }),
        (resourceCount, targetIdx) => {
          const idx = Math.min(targetIdx, resourceCount - 1);
          const manifest = validBaseManifest(resourceCount);

          const violatingResource = manifest.resources[idx] as Record<string, unknown>;
          delete violatingResource.modificationType;

          const result = validateManifest(manifest);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.path).toBeDefined();
            expect(result.path).toContain(`resources[${idx}]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.6**
   *
   * Invalid modification type (not one of Add, Modify, Remove, Replace)
   * Should reject with path pointing to the violating resource.
   */
  it('should reject manifests with invalid modificationType and return correct error path', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 9 }),
        arbitraryInvalidModificationType(),
        (resourceCount, targetIdx, invalidType) => {
          const idx = Math.min(targetIdx, resourceCount - 1);
          const manifest = validBaseManifest(resourceCount);

          (manifest.resources[idx] as Record<string, unknown>).modificationType = invalidType;

          const result = validateManifest(manifest);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.path).toBeDefined();
            expect(result.path).toContain(`resources[${idx}]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.6**
   *
   * Empty string for required fields should reject with path.
   */
  it('should reject manifests with empty string resourceType and return correct error path', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 9 }),
        (resourceCount, targetIdx) => {
          const idx = Math.min(targetIdx, resourceCount - 1);
          const manifest = validBaseManifest(resourceCount);

          (manifest.resources[idx] as Record<string, unknown>).resourceType = '';

          const result = validateManifest(manifest);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.path).toBeDefined();
            expect(result.path).toContain(`resources[${idx}]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject manifests with empty string resourceId and return correct error path', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 9 }),
        (resourceCount, targetIdx) => {
          const idx = Math.min(targetIdx, resourceCount - 1);
          const manifest = validBaseManifest(resourceCount);

          (manifest.resources[idx] as Record<string, unknown>).resourceId = '';

          const result = validateManifest(manifest);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.path).toBeDefined();
            expect(result.path).toContain(`resources[${idx}]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject manifests with empty string provider and return correct error path', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 9 }),
        (resourceCount, targetIdx) => {
          const idx = Math.min(targetIdx, resourceCount - 1);
          const manifest = validBaseManifest(resourceCount);

          (manifest.resources[idx] as Record<string, unknown>).provider = '';

          const result = validateManifest(manifest);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.path).toBeDefined();
            expect(result.path).toContain(`resources[${idx}]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.6**
   *
   * Exceeding 200 resources should reject with appropriate error.
   */
  it('should reject manifests exceeding 200 resources', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 201, max: 250 }),
        (resourceCount) => {
          const manifest = validBaseManifest(resourceCount);

          const result = validateManifest(manifest);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toContain('200');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.6**
   *
   * Exceeding 10 MB payload should reject with size error.
   */
  it('should reject manifests exceeding 10 MB payload size', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        (extraMB) => {
          // Create a manifest with a large properties field that exceeds 10 MB
          // 10 MB = 10 * 1024 * 1024 = 10,485,760 bytes
          // We need the JSON-serialized form to exceed this limit
          const manifest = validBaseManifest(1);
          const largeString = 'x'.repeat(5 * 1024 * 1024 + extraMB * 1024 * 1024);
          (manifest.resources[0] as Record<string, unknown>).properties = {
            before: { data: largeString },
            after: { data: largeString },
          };

          const result = validateManifest(manifest);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.toLowerCase()).toContain('size');
            expect(result.error).toContain('10 MB');
          }
        }
      ),
      { numRuns: 5 } // fewer runs due to large memory allocation
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.6**
   *
   * Atomic validation: the entire manifest is rejected when any single resource
   * has a violation, even if other resources are valid.
   */
  it('should reject the entire manifest when only one resource has a violation among valid ones', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        fc.constantFrom('resourceType', 'resourceId', 'provider', 'modificationType'),
        (resourceCount, fieldToRemove) => {
          const manifest = validBaseManifest(resourceCount);

          // Pick a random resource to violate (always the last one for determinism)
          const violatingIdx = resourceCount - 1;
          const violatingResource = manifest.resources[violatingIdx] as Record<string, unknown>;
          delete violatingResource[fieldToRemove];

          const result = validateManifest(manifest);

          // Entire manifest must be rejected
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.path).toBeDefined();
            expect(result.path).toContain(`resources[${violatingIdx}]`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
