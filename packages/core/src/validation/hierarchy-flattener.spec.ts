/**
 * Property-based tests for hierarchy flattening.
 *
 * Feature: blast-radius-visualizer, Property 3: Hierarchy Flattening Preserves All Resources
 *
 * Validates: Requirements 1.4
 *
 * For any ResourceChangeManifest with nested groups (depth 1-10), flattening
 * the hierarchy SHALL produce a flat list containing exactly the same set of
 * resources as the nested input — no resources lost, duplicated, or modified.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { flattenHierarchy } from './hierarchy-flattener';
import type {
  ResourceChange,
  ManifestGroup,
  ResourceChangeManifest,
  ModificationType,
} from '../models/manifest';

// --- Custom Generators ---

/**
 * Generates a valid ResourceChange object with unique identifiers.
 */
function arbitraryResourceChange(): fc.Arbitrary<ResourceChange> {
  return fc.record({
    resourceType: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')), {
      minLength: 3,
      maxLength: 30,
    }),
    resourceId: fc.uuid(),
    provider: fc.constantFrom('aws', 'azure', 'gcp'),
    modificationType: fc.constantFrom('Add', 'Modify', 'Remove', 'Replace') as fc.Arbitrary<ModificationType>,
  });
}

/**
 * Generates a ManifestGroup with recursive nesting up to maxDepth.
 * Each group contains 0-5 resources and 0-3 subgroups.
 */
function arbitraryManifestGroup(maxDepth: number): fc.Arbitrary<ManifestGroup> {
  if (maxDepth <= 1) {
    return fc.record({
      name: fc.string({ minLength: 1, maxLength: 20 }),
      resources: fc.array(arbitraryResourceChange(), { minLength: 0, maxLength: 5 }),
    }).map((g) => ({ ...g, groups: undefined }));
  }

  return fc.record({
    name: fc.string({ minLength: 1, maxLength: 20 }),
    resources: fc.array(arbitraryResourceChange(), { minLength: 0, maxLength: 5 }),
    groups: fc.option(
      fc.array(arbitraryManifestGroup(maxDepth - 1), { minLength: 0, maxLength: 3 }),
      { nil: undefined }
    ),
  });
}

/**
 * Generates a ResourceChangeManifest with nested groups.
 * @param options - Configuration for the generator
 * @param options.maxDepth - Maximum nesting depth for groups (1-10)
 * @param options.minTopResources - Minimum top-level resources
 * @param options.maxTopResources - Maximum top-level resources
 */
function arbitraryManifestWithGroups(options?: {
  maxDepth?: number;
  minTopResources?: number;
  maxTopResources?: number;
  minGroups?: number;
  maxGroups?: number;
}): fc.Arbitrary<ResourceChangeManifest> {
  const maxDepth = options?.maxDepth ?? 5;
  const minTopResources = options?.minTopResources ?? 0;
  const maxTopResources = options?.maxTopResources ?? 10;
  const minGroups = options?.minGroups ?? 1;
  const maxGroups = options?.maxGroups ?? 4;

  return fc.record({
    version: fc.constant('1.0'),
    metadata: fc.record({
      submittedAt: fc.constant('2024-01-15T10:30:00Z'),
      sourceFormat: fc.constantFrom('terraform-plan', 'cloudformation', 'cdk', 'pulumi'),
    }),
    resources: fc.array(arbitraryResourceChange(), {
      minLength: minTopResources,
      maxLength: maxTopResources,
    }),
    groups: fc.array(arbitraryManifestGroup(maxDepth), {
      minLength: minGroups,
      maxLength: maxGroups,
    }),
  });
}

// --- Helper Functions ---

/**
 * Recursively counts all resources in a manifest (top-level + all nested groups).
 */
function countAllResources(manifest: ResourceChangeManifest): number {
  let count = manifest.resources.length;
  if (manifest.groups) {
    count += countResourcesInGroups(manifest.groups);
  }
  return count;
}

/**
 * Recursively counts resources in a list of groups.
 */
function countResourcesInGroups(groups: ManifestGroup[]): number {
  let count = 0;
  for (const group of groups) {
    count += group.resources.length;
    if (group.groups && group.groups.length > 0) {
      count += countResourcesInGroups(group.groups);
    }
  }
  return count;
}

/**
 * Recursively collects all resources from a manifest into a flat array.
 */
function collectAllResources(manifest: ResourceChangeManifest): ResourceChange[] {
  const all: ResourceChange[] = [...manifest.resources];
  if (manifest.groups) {
    collectResourcesFromGroups(manifest.groups, all);
  }
  return all;
}

/**
 * Recursively collects resources from groups.
 */
function collectResourcesFromGroups(groups: ManifestGroup[], collected: ResourceChange[]): void {
  for (const group of groups) {
    for (const resource of group.resources) {
      collected.push(resource);
    }
    if (group.groups && group.groups.length > 0) {
      collectResourcesFromGroups(group.groups, collected);
    }
  }
}

/**
 * Generates a manifest with groups nested exactly at the specified depth.
 */
function arbitraryManifestAtExactDepth(depth: number): fc.Arbitrary<ResourceChangeManifest> {
  function buildGroupAtDepth(d: number): fc.Arbitrary<ManifestGroup> {
    if (d <= 1) {
      return fc.record({
        name: fc.string({ minLength: 1, maxLength: 10 }),
        resources: fc.array(arbitraryResourceChange(), { minLength: 1, maxLength: 3 }),
      }).map((g) => ({ ...g, groups: undefined }));
    }
    return fc.record({
      name: fc.string({ minLength: 1, maxLength: 10 }),
      resources: fc.array(arbitraryResourceChange(), { minLength: 0, maxLength: 3 }),
      groups: fc.array(buildGroupAtDepth(d - 1), { minLength: 1, maxLength: 2 }),
    });
  }

  return fc.record({
    version: fc.constant('1.0'),
    metadata: fc.record({
      submittedAt: fc.constant('2024-01-15T10:30:00Z'),
      sourceFormat: fc.constant('canonical'),
    }),
    resources: fc.array(arbitraryResourceChange(), { minLength: 0, maxLength: 5 }),
    groups: fc.array(buildGroupAtDepth(depth), { minLength: 1, maxLength: 2 }),
  });
}

// --- Property Tests ---

describe('Feature: blast-radius-visualizer, Property 3: Hierarchy Flattening Preserves All Resources', () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * Flattening preserves total resource count: the sum of all resources at all
   * levels equals the flattened count.
   */
  it('flattening preserves total resource count', () => {
    fc.assert(
      fc.property(
        arbitraryManifestWithGroups({ maxDepth: 10 }),
        (manifest) => {
          const result = flattenHierarchy(manifest);

          expect(result.success).toBe(true);
          if (result.success) {
            const expectedCount = countAllResources(manifest);
            expect(result.resources.length).toBe(expectedCount);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Flattening preserves resource identity: every resource in the nested
   * structure appears in the flat output with identical fields.
   */
  it('flattening preserves resource identity', () => {
    fc.assert(
      fc.property(
        arbitraryManifestWithGroups({ maxDepth: 10 }),
        (manifest) => {
          const result = flattenHierarchy(manifest);

          expect(result.success).toBe(true);
          if (result.success) {
            const allOriginal = collectAllResources(manifest);

            // Every resource from the nested structure must appear in the flat output
            for (const original of allOriginal) {
              const found = result.resources.some(
                (r) =>
                  r.resourceId === original.resourceId &&
                  r.resourceType === original.resourceType &&
                  r.provider === original.provider &&
                  r.modificationType === original.modificationType
              );
              expect(found).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Flattening does not introduce duplicates: the flat count equals the total
   * nested count (no extra resources added).
   */
  it('flattening does not introduce duplicates', () => {
    fc.assert(
      fc.property(
        arbitraryManifestWithGroups({ maxDepth: 10 }),
        (manifest) => {
          const result = flattenHierarchy(manifest);

          expect(result.success).toBe(true);
          if (result.success) {
            const expectedCount = countAllResources(manifest);
            // If flat count equals nested count, no duplicates were introduced
            expect(result.resources.length).toBe(expectedCount);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Flattening rejects groups exceeding 10 levels of nesting with an error path.
   */
  it('flattening rejects groups exceeding 10 levels of nesting with error path', () => {
    fc.assert(
      fc.property(
        arbitraryManifestAtExactDepth(11),
        (manifest) => {
          const result = flattenHierarchy(manifest);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toContain('10');
            expect(result.path).toBeDefined();
            expect(result.path.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Flattening works correctly with empty groups (groups with no resources).
   */
  it('flattening works correctly with empty groups', () => {
    fc.assert(
      fc.property(
        arbitraryManifestWithGroups({
          maxDepth: 5,
          minTopResources: 1,
          maxTopResources: 5,
        }),
        (manifest) => {
          // Replace all group resources with empty arrays to test empty groups
          function emptyGroupResources(groups: ManifestGroup[]): ManifestGroup[] {
            return groups.map((g) => ({
              ...g,
              resources: [],
              groups: g.groups ? emptyGroupResources(g.groups) : undefined,
            }));
          }

          const manifestWithEmptyGroups: ResourceChangeManifest = {
            ...manifest,
            groups: manifest.groups ? emptyGroupResources(manifest.groups) : undefined,
          };

          const result = flattenHierarchy(manifestWithEmptyGroups);

          expect(result.success).toBe(true);
          if (result.success) {
            // Only top-level resources should remain since all group resources are empty
            expect(result.resources.length).toBe(manifestWithEmptyGroups.resources.length);
            // Each top-level resource should be present
            for (const resource of manifestWithEmptyGroups.resources) {
              const found = result.resources.some(
                (r) => r.resourceId === resource.resourceId
              );
              expect(found).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
