"use strict";
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
const hierarchy_flattener_1 = require("./hierarchy-flattener");
// --- Custom Generators ---
/**
 * Generates a valid ResourceChange object with unique identifiers.
 */
function arbitraryResourceChange() {
    return fc.record({
        resourceType: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')), {
            minLength: 3,
            maxLength: 30,
        }),
        resourceId: fc.uuid(),
        provider: fc.constantFrom('aws', 'azure', 'gcp'),
        modificationType: fc.constantFrom('Add', 'Modify', 'Remove', 'Replace'),
    });
}
/**
 * Generates a ManifestGroup with recursive nesting up to maxDepth.
 * Each group contains 0-5 resources and 0-3 subgroups.
 */
function arbitraryManifestGroup(maxDepth) {
    if (maxDepth <= 1) {
        return fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            resources: fc.array(arbitraryResourceChange(), { minLength: 0, maxLength: 5 }),
        }).map((g) => ({ ...g, groups: undefined }));
    }
    return fc.record({
        name: fc.string({ minLength: 1, maxLength: 20 }),
        resources: fc.array(arbitraryResourceChange(), { minLength: 0, maxLength: 5 }),
        groups: fc.option(fc.array(arbitraryManifestGroup(maxDepth - 1), { minLength: 0, maxLength: 3 }), { nil: undefined }),
    });
}
/**
 * Generates a ResourceChangeManifest with nested groups.
 * @param options - Configuration for the generator
 * @param options.maxDepth - Maximum nesting depth for groups (1-10)
 * @param options.minTopResources - Minimum top-level resources
 * @param options.maxTopResources - Maximum top-level resources
 */
function arbitraryManifestWithGroups(options) {
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
function countAllResources(manifest) {
    let count = manifest.resources.length;
    if (manifest.groups) {
        count += countResourcesInGroups(manifest.groups);
    }
    return count;
}
/**
 * Recursively counts resources in a list of groups.
 */
function countResourcesInGroups(groups) {
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
function collectAllResources(manifest) {
    const all = [...manifest.resources];
    if (manifest.groups) {
        collectResourcesFromGroups(manifest.groups, all);
    }
    return all;
}
/**
 * Recursively collects resources from groups.
 */
function collectResourcesFromGroups(groups, collected) {
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
function arbitraryManifestAtExactDepth(depth) {
    function buildGroupAtDepth(d) {
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
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 3: Hierarchy Flattening Preserves All Resources', () => {
    /**
     * **Validates: Requirements 1.4**
     *
     * Flattening preserves total resource count: the sum of all resources at all
     * levels equals the flattened count.
     */
    (0, vitest_1.it)('flattening preserves total resource count', () => {
        fc.assert(fc.property(arbitraryManifestWithGroups({ maxDepth: 10 }), (manifest) => {
            const result = (0, hierarchy_flattener_1.flattenHierarchy)(manifest);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                const expectedCount = countAllResources(manifest);
                (0, vitest_1.expect)(result.resources.length).toBe(expectedCount);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 1.4**
     *
     * Flattening preserves resource identity: every resource in the nested
     * structure appears in the flat output with identical fields.
     */
    (0, vitest_1.it)('flattening preserves resource identity', () => {
        fc.assert(fc.property(arbitraryManifestWithGroups({ maxDepth: 10 }), (manifest) => {
            const result = (0, hierarchy_flattener_1.flattenHierarchy)(manifest);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                const allOriginal = collectAllResources(manifest);
                // Every resource from the nested structure must appear in the flat output
                for (const original of allOriginal) {
                    const found = result.resources.some((r) => r.resourceId === original.resourceId &&
                        r.resourceType === original.resourceType &&
                        r.provider === original.provider &&
                        r.modificationType === original.modificationType);
                    (0, vitest_1.expect)(found).toBe(true);
                }
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 1.4**
     *
     * Flattening does not introduce duplicates: the flat count equals the total
     * nested count (no extra resources added).
     */
    (0, vitest_1.it)('flattening does not introduce duplicates', () => {
        fc.assert(fc.property(arbitraryManifestWithGroups({ maxDepth: 10 }), (manifest) => {
            const result = (0, hierarchy_flattener_1.flattenHierarchy)(manifest);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                const expectedCount = countAllResources(manifest);
                // If flat count equals nested count, no duplicates were introduced
                (0, vitest_1.expect)(result.resources.length).toBe(expectedCount);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 1.4**
     *
     * Flattening rejects groups exceeding 10 levels of nesting with an error path.
     */
    (0, vitest_1.it)('flattening rejects groups exceeding 10 levels of nesting with error path', () => {
        fc.assert(fc.property(arbitraryManifestAtExactDepth(11), (manifest) => {
            const result = (0, hierarchy_flattener_1.flattenHierarchy)(manifest);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, vitest_1.expect)(result.error).toContain('10');
                (0, vitest_1.expect)(result.path).toBeDefined();
                (0, vitest_1.expect)(result.path.length).toBeGreaterThan(0);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 1.4**
     *
     * Flattening works correctly with empty groups (groups with no resources).
     */
    (0, vitest_1.it)('flattening works correctly with empty groups', () => {
        fc.assert(fc.property(arbitraryManifestWithGroups({
            maxDepth: 5,
            minTopResources: 1,
            maxTopResources: 5,
        }), (manifest) => {
            // Replace all group resources with empty arrays to test empty groups
            function emptyGroupResources(groups) {
                return groups.map((g) => ({
                    ...g,
                    resources: [],
                    groups: g.groups ? emptyGroupResources(g.groups) : undefined,
                }));
            }
            const manifestWithEmptyGroups = {
                ...manifest,
                groups: manifest.groups ? emptyGroupResources(manifest.groups) : undefined,
            };
            const result = (0, hierarchy_flattener_1.flattenHierarchy)(manifestWithEmptyGroups);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (result.success) {
                // Only top-level resources should remain since all group resources are empty
                (0, vitest_1.expect)(result.resources.length).toBe(manifestWithEmptyGroups.resources.length);
                // Each top-level resource should be present
                for (const resource of manifestWithEmptyGroups.resources) {
                    const found = result.resources.some((r) => r.resourceId === resource.resourceId);
                    (0, vitest_1.expect)(found).toBe(true);
                }
            }
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=hierarchy-flattener.spec.js.map