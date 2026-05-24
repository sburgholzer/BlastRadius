/**
 * Hierarchy flattener for Resource Change Manifests.
 *
 * Recursively flattens nested groups into a single resource list.
 * Enforces max 10 levels of nesting depth.
 * Returns error with group path when depth limit exceeded.
 * Preserves all resource entries without duplication or loss.
 */

import type { ResourceChange, ManifestGroup, ResourceChangeManifest } from '../models/manifest';

const MAX_NESTING_DEPTH = 10;

export type FlattenResult =
  | { success: true; resources: ResourceChange[] }
  | { success: false; error: string; path: string };

/**
 * Collects resources from a group and its nested subgroups recursively.
 * Tracks current depth and returns an error if the depth limit is exceeded.
 */
function collectFromGroups(
  groups: ManifestGroup[],
  currentDepth: number,
  currentPath: string
): FlattenResult {
  if (currentDepth > MAX_NESTING_DEPTH) {
    return {
      success: false,
      error: `Group nesting exceeds maximum depth of ${MAX_NESTING_DEPTH} levels`,
      path: currentPath,
    };
  }

  const collected: ResourceChange[] = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const groupPath = `${currentPath}[${i}]`;

    // Collect resources from this group
    for (const resource of group.resources) {
      collected.push(resource);
    }

    // Recurse into nested groups if present
    if (group.groups && group.groups.length > 0) {
      const nestedResult = collectFromGroups(
        group.groups,
        currentDepth + 1,
        `${groupPath}.groups`
      );

      if (!nestedResult.success) {
        return nestedResult;
      }

      for (const resource of nestedResult.resources) {
        collected.push(resource);
      }
    }
  }

  return { success: true, resources: collected };
}

/**
 * Recursively flattens nested groups into a single resource list.
 * Enforces max 10 levels of nesting depth.
 * Returns error with group path when depth limit exceeded.
 * Preserves all resource entries without duplication or loss.
 */
export function flattenHierarchy(manifest: ResourceChangeManifest): FlattenResult {
  // Start with top-level resources
  const resources: ResourceChange[] = [...manifest.resources];

  // If groups exist, recursively collect all resources from them
  if (manifest.groups && manifest.groups.length > 0) {
    const groupResult = collectFromGroups(manifest.groups, 1, 'groups');

    if (!groupResult.success) {
      return groupResult;
    }

    for (const resource of groupResult.resources) {
      resources.push(resource);
    }
  }

  return { success: true, resources };
}
