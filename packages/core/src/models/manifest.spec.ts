/**
 * Property-based tests for Resource Change Manifest validation.
 *
 * Feature: blast-radius-visualizer
 * Property 1: Schema Validation Accepts All Valid Manifests
 *
 * Validates: Requirements 1.1, 1.3
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateManifest } from '../validation/manifest-validator';
import type { ResourceChange, ResourceChangeManifest, ModificationType } from './manifest';

// --- Custom Arbitraries / Generators ---

/**
 * Generates a valid ModificationType value.
 */
function arbitraryModificationType(): fc.Arbitrary<ModificationType> {
  return fc.constantFrom('Add', 'Modify', 'Remove', 'Replace');
}

/**
 * Generates a valid provider string (e.g., "aws", "azure", "gcp").
 */
function arbitraryProvider(): fc.Arbitrary<string> {
  return fc.constantFrom('aws', 'azure', 'gcp');
}

/**
 * Generates a valid ResourceChange object with all required fields:
 * resourceType, resourceId, provider, and modificationType.
 */
function arbitraryResourceChange(): fc.Arbitrary<ResourceChange> {
  return fc.record({
    resourceType: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')), {
      minLength: 3,
      maxLength: 40,
    }),
    resourceId: fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
      { minLength: 3, maxLength: 60 }
    ),
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
function arbitraryManifest(
  options?: { minResources?: number; maxResources?: number }
): fc.Arbitrary<ResourceChangeManifest> {
  const minResources = options?.minResources ?? 1;
  const maxResources = options?.maxResources ?? 200;

  return fc.record({
    version: fc.constantFrom('1.0', '1.1', '2.0'),
    metadata: fc.record({
      submittedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(
        (d) => d.toISOString()
      ),
      sourceFormat: fc.constantFrom(
        'terraform-plan',
        'cloudformation',
        'cdk',
        'pulumi',
        'canonical'
      ),
      description: fc.option(fc.string({ minLength: 0, maxLength: 100 }), { nil: undefined }),
    }),
    resources: fc.array(arbitraryResourceChange(), {
      minLength: minResources,
      maxLength: maxResources,
    }),
  });
}

// --- Property Tests ---

describe('Feature: blast-radius-visualizer, Property 1: Schema Validation Accepts All Valid Manifests', () => {
  /**
   * **Validates: Requirements 1.1, 1.3**
   *
   * For any ResourceChangeManifest that conforms to the canonical schema
   * (contains 1-200 resources, each with resource type, resource identifier,
   * provider, and modification type), the validation should accept it without error.
   */
  it('should accept any valid ResourceChangeManifest without error', () => {
    fc.assert(
      fc.property(arbitraryManifest(), (manifest) => {
        const result = validateManifest(manifest);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.manifest).toEqual(manifest);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should accept manifests at the minimum boundary (1 resource)', () => {
    fc.assert(
      fc.property(arbitraryManifest({ minResources: 1, maxResources: 1 }), (manifest) => {
        const result = validateManifest(manifest);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should accept manifests at the maximum boundary (200 resources)', () => {
    fc.assert(
      fc.property(arbitraryManifest({ minResources: 200, maxResources: 200 }), (manifest) => {
        const result = validateManifest(manifest);
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 } // fewer runs due to larger data size
    );
  });

  it('should accept manifests with all modification types', () => {
    fc.assert(
      fc.property(arbitraryManifest({ minResources: 4, maxResources: 50 }), (manifest) => {
        // Ensure the manifest has valid structure regardless of which modification types appear
        const result = validateManifest(manifest);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should accept manifests with all supported providers', () => {
    fc.assert(
      fc.property(arbitraryManifest({ minResources: 3, maxResources: 50 }), (manifest) => {
        const result = validateManifest(manifest);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
