/**
 * Canonical Resource Change Manifest schema validation using Zod.
 *
 * Validates incoming manifests against the canonical schema, enforces
 * size/depth limits, and returns structured errors with JSON paths.
 */

import { z } from 'zod';
import type { ResourceChangeManifest } from '../models/manifest';

// --- Constants ---

const MAX_RESOURCES = 200;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_NESTING_DEPTH = 10;

// --- Zod Schemas ---

const ModificationTypeSchema = z.enum(['Add', 'Modify', 'Remove', 'Replace']);

const ResourceChangeSchema = z.object({
  resourceType: z.string().min(1, 'resourceType must be a non-empty string'),
  resourceId: z.string().min(1, 'resourceId must be a non-empty string'),
  provider: z.string().min(1, 'provider must be a non-empty string'),
  modificationType: ModificationTypeSchema,
  region: z.string().optional(),
  accountId: z.string().optional(),
  properties: z
    .object({
      before: z.record(z.unknown()).optional(),
      after: z.record(z.unknown()).optional(),
    })
    .optional(),
});

const ManifestMetadataSchema = z.object({
  submittedAt: z.string().min(1, 'submittedAt must be a non-empty string'),
  sourceFormat: z.string().min(1, 'sourceFormat must be a non-empty string'),
  description: z.string().optional(),
});

// Recursive group schema with depth tracking handled separately
const BaseManifestGroupSchema = z.object({
  name: z.string().min(1, 'group name must be a non-empty string'),
  resources: z.array(ResourceChangeSchema),
});

type ManifestGroupInput = z.infer<typeof BaseManifestGroupSchema> & {
  groups?: ManifestGroupInput[];
};

const ManifestGroupSchema: z.ZodType<ManifestGroupInput> = BaseManifestGroupSchema.extend({
  groups: z.lazy(() => z.array(ManifestGroupSchema)).optional(),
});

const ResourceChangeManifestSchema = z.object({
  version: z.string().min(1, 'version must be a non-empty string'),
  metadata: ManifestMetadataSchema,
  resources: z
    .array(ResourceChangeSchema)
    .max(MAX_RESOURCES, `resources array must not exceed ${MAX_RESOURCES} entries`),
  groups: z.array(ManifestGroupSchema).optional(),
});

// --- Validation Result Type ---

export type ValidationResult =
  | { success: true; manifest: ResourceChangeManifest }
  | { success: false; error: string; path?: string };

// --- Helper Functions ---

/**
 * Checks the nesting depth of groups recursively.
 * Returns the path where the depth limit is exceeded, or null if within limits.
 */
function checkNestingDepth(
  groups: unknown[] | undefined,
  currentDepth: number,
  currentPath: string
): string | null {
  if (!groups || !Array.isArray(groups)) {
    return null;
  }

  if (currentDepth > MAX_NESTING_DEPTH) {
    return currentPath;
  }

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i] as { groups?: unknown[] };
    if (group && group.groups) {
      const result = checkNestingDepth(
        group.groups,
        currentDepth + 1,
        `${currentPath}[${i}].groups`
      );
      if (result !== null) {
        return result;
      }
    }
  }

  return null;
}

/**
 * Converts a Zod issue path to a JSON path string.
 */
function formatZodPath(path: (string | number)[]): string {
  if (path.length === 0) return '';

  let result = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      result += `[${segment}]`;
    } else {
      result += result.length === 0 ? segment : `.${segment}`;
    }
  }
  return result;
}

// --- Main Validation Function ---

/**
 * Validates an unknown input against the canonical ResourceChangeManifest schema.
 *
 * Performs atomic validation — the entire manifest is rejected on any failure.
 * Checks payload size before schema validation.
 * Returns structured errors with the JSON path of the first violation.
 */
export function validateManifest(input: unknown): ValidationResult {
  // Check payload size first (413-style rejection for oversized payloads)
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return {
      success: false,
      error: 'Input cannot be serialized to JSON',
    };
  }

  if (serialized.length > MAX_PAYLOAD_BYTES) {
    return {
      success: false,
      error: `Payload size exceeds maximum of 10 MB (got ${serialized.length} bytes)`,
    };
  }

  // Schema validation
  const parseResult = ResourceChangeManifestSchema.safeParse(input);

  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    const path = formatZodPath(firstIssue.path);
    return {
      success: false,
      error: firstIssue.message,
      path: path || undefined,
    };
  }

  // Check nesting depth for groups
  const manifest = parseResult.data;
  if (manifest.groups) {
    const depthViolation = checkNestingDepth(manifest.groups, 1, 'groups');
    if (depthViolation !== null) {
      return {
        success: false,
        error: `Group nesting exceeds maximum depth of ${MAX_NESTING_DEPTH} levels`,
        path: depthViolation,
      };
    }
  }

  return {
    success: true,
    manifest: parseResult.data as ResourceChangeManifest,
  };
}
