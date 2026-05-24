/**
 * CDK Manifest Adapter.
 *
 * Converts CDK cloud assembly diff format into a canonical
 * ResourceChangeManifest. Maps CDK changeType values to canonical
 * modification types and flattens nested construct trees / nested stacks.
 */

import type { ResourceChangeManifest, ResourceChange, ModificationType } from '@blast-radius/core';

/**
 * Property change detail in a CDK diff resource entry.
 */
export interface CdkPropertyChange {
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * A single resource entry within a CDK diff resource type group.
 */
export interface CdkResourceEntry {
  changeType?: string;
  logicalId?: string;
  physicalId?: string;
  properties?: Record<string, CdkPropertyChange>;
}

/**
 * Resources grouped by resource type in the CDK diff format.
 * Each key is a resource type (e.g., "AWS::S3::Bucket"), and the value
 * is a map of logical IDs to resource entries.
 */
export type CdkResourceTypeGroup = Record<string, CdkResourceEntry>;

/**
 * The resources section of a CDK diff — keyed by resource type.
 */
export type CdkResources = Record<string, CdkResourceTypeGroup>;

/**
 * A nested stack entry in the CDK diff format.
 */
export interface CdkNestedStack {
  resources?: CdkResources;
  nestedStacks?: Record<string, CdkNestedStack>;
}

/**
 * Top-level CDK cloud assembly diff structure.
 */
export interface CdkCloudAssemblyDiff {
  stackName?: string;
  resources?: CdkResources;
  nestedStacks?: Record<string, CdkNestedStack>;
}

/**
 * Error response returned when the CDK diff is malformed.
 */
export interface CdkAdapterError {
  error: string;
  location?: string;
}

/**
 * Successful adapter output.
 */
export interface CdkAdapterOutput {
  manifest: ResourceChangeManifest;
  warnings: string[];
}

/** Result type from the handler. */
export type CdkAdapterResult = CdkAdapterOutput | CdkAdapterError;

/**
 * Maps a CDK changeType to a canonical ModificationType.
 *
 * Mapping rules:
 * - "CREATE" → "Add"
 * - "UPDATE" → "Modify"
 * - "DELETE" → "Remove"
 * - "REPLACE" → "Replace"
 */
export function mapChangeTypeToModificationType(changeType: string): ModificationType {
  switch (changeType.toUpperCase()) {
    case 'CREATE':
      return 'Add';
    case 'UPDATE':
      return 'Modify';
    case 'DELETE':
      return 'Remove';
    case 'REPLACE':
      return 'Replace';
    default:
      return 'Modify';
  }
}

/**
 * Validates that the input has the expected CDK cloud assembly diff structure.
 * Returns an error with location if the input is malformed.
 */
function validateDiffStructure(input: unknown): CdkAdapterError | null {
  if (input === null || input === undefined) {
    return { error: 'Input is null or undefined', location: '$' };
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Input must be a non-array object', location: '$' };
  }

  const diff = input as Record<string, unknown>;

  if (!('resources' in diff)) {
    return { error: 'Missing required field "resources"', location: '$' };
  }

  if (diff.resources === null || typeof diff.resources !== 'object' || Array.isArray(diff.resources)) {
    return { error: '"resources" must be a non-array object', location: '$.resources' };
  }

  // Validate nestedStacks if present
  if ('nestedStacks' in diff && diff.nestedStacks !== undefined) {
    if (diff.nestedStacks === null || typeof diff.nestedStacks !== 'object' || Array.isArray(diff.nestedStacks)) {
      return { error: '"nestedStacks" must be a non-array object', location: '$.nestedStacks' };
    }
  }

  return null;
}

/**
 * Validates a resource type group and its entries.
 * Returns an error with location if any entry is malformed.
 */
function validateResourceTypeGroup(
  resourceType: string,
  group: unknown,
  pathPrefix: string,
): CdkAdapterError | null {
  if (group === null || typeof group !== 'object' || Array.isArray(group)) {
    return {
      error: `Resource type group "${resourceType}" must be a non-array object`,
      location: `${pathPrefix}.${resourceType}`,
    };
  }

  const entries = group as Record<string, unknown>;

  for (const logicalId of Object.keys(entries)) {
    const entry = entries[logicalId];

    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return {
        error: `Resource entry "${logicalId}" must be a non-array object`,
        location: `${pathPrefix}.${resourceType}.${logicalId}`,
      };
    }

    const resourceEntry = entry as Record<string, unknown>;

    if (!resourceEntry.changeType || typeof resourceEntry.changeType !== 'string') {
      return {
        error: `Missing or invalid "changeType" for resource "${logicalId}"`,
        location: `${pathPrefix}.${resourceType}.${logicalId}.changeType`,
      };
    }
  }

  return null;
}

/**
 * Extracts property changes from a CDK resource entry into before/after format.
 */
function extractProperties(
  properties?: Record<string, CdkPropertyChange>,
): { before?: Record<string, unknown>; after?: Record<string, unknown> } | undefined {
  if (!properties || Object.keys(properties).length === 0) {
    return undefined;
  }

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  let hasBefore = false;
  let hasAfter = false;

  for (const [key, change] of Object.entries(properties)) {
    if (change.oldValue !== undefined) {
      before[key] = change.oldValue;
      hasBefore = true;
    }
    if (change.newValue !== undefined) {
      after[key] = change.newValue;
      hasAfter = true;
    }
  }

  if (!hasBefore && !hasAfter) {
    return undefined;
  }

  return {
    ...(hasBefore && { before }),
    ...(hasAfter && { after }),
  };
}

/**
 * Converts a CDK resource entry into a canonical ResourceChange.
 */
function convertResourceEntry(
  resourceType: string,
  _logicalId: string,
  entry: CdkResourceEntry,
): ResourceChange {
  const modificationType = mapChangeTypeToModificationType(entry.changeType!);
  const properties = extractProperties(entry.properties);

  return {
    resourceType,
    resourceId: entry.physicalId || entry.logicalId || _logicalId,
    provider: 'aws',
    modificationType,
    ...(properties && { properties }),
  };
}

/**
 * Recursively processes a resources section and collects canonical ResourceChange entries.
 * Validates each resource type group and entry along the way.
 */
function processResources(
  resources: CdkResources,
  pathPrefix: string,
  output: ResourceChange[],
  warnings: string[],
): CdkAdapterError | null {
  for (const resourceType of Object.keys(resources)) {
    const group = resources[resourceType];

    // Validate the resource type group
    const groupError = validateResourceTypeGroup(resourceType, group, pathPrefix);
    if (groupError) {
      return groupError;
    }

    // Process each resource entry in the group
    for (const logicalId of Object.keys(group)) {
      const entry = group[logicalId] as CdkResourceEntry;
      output.push(convertResourceEntry(resourceType, logicalId, entry));
    }
  }

  return null;
}

/**
 * Recursively flattens nested stacks, collecting all resource changes.
 * Validates nested stack structure at each level.
 */
function flattenNestedStacks(
  nestedStacks: Record<string, CdkNestedStack>,
  pathPrefix: string,
  output: ResourceChange[],
  warnings: string[],
  depth: number = 0,
  maxDepth: number = 10,
): CdkAdapterError | null {
  if (depth >= maxDepth) {
    return {
      error: `Nested stack depth exceeds maximum of ${maxDepth} levels`,
      location: pathPrefix,
    };
  }

  for (const stackName of Object.keys(nestedStacks)) {
    const nestedStack = nestedStacks[stackName];
    const stackPath = `${pathPrefix}.${stackName}`;

    if (nestedStack === null || typeof nestedStack !== 'object' || Array.isArray(nestedStack)) {
      return {
        error: `Nested stack "${stackName}" must be a non-array object`,
        location: stackPath,
      };
    }

    // Process resources in this nested stack
    if (nestedStack.resources) {
      if (typeof nestedStack.resources !== 'object' || Array.isArray(nestedStack.resources)) {
        return {
          error: `"resources" in nested stack "${stackName}" must be a non-array object`,
          location: `${stackPath}.resources`,
        };
      }

      const resourceError = processResources(
        nestedStack.resources,
        `${stackPath}.resources`,
        output,
        warnings,
      );
      if (resourceError) {
        return resourceError;
      }
    }

    // Recursively process further nested stacks
    if (nestedStack.nestedStacks) {
      if (typeof nestedStack.nestedStacks !== 'object' || Array.isArray(nestedStack.nestedStacks)) {
        return {
          error: `"nestedStacks" in nested stack "${stackName}" must be a non-array object`,
          location: `${stackPath}.nestedStacks`,
        };
      }

      const nestedError = flattenNestedStacks(
        nestedStack.nestedStacks,
        `${stackPath}.nestedStacks`,
        output,
        warnings,
        depth + 1,
        maxDepth,
      );
      if (nestedError) {
        return nestedError;
      }
    }
  }

  return null;
}

/**
 * CDK Manifest Adapter handler.
 *
 * Converts a CDK cloud assembly diff into a canonical ResourceChangeManifest.
 *
 * 1. Validates the input has the expected CDK diff structure.
 * 2. Iterates over resources grouped by resource type.
 * 3. Flattens nested stacks recursively.
 * 4. Maps to canonical format.
 * 5. Returns error with location if input is malformed.
 */
export function handler(event: unknown): CdkAdapterResult {
  // Validate top-level structure
  const structureError = validateDiffStructure(event);
  if (structureError) {
    return structureError;
  }

  const diff = event as CdkCloudAssemblyDiff;
  const resources: ResourceChange[] = [];
  const warnings: string[] = [];

  // Process top-level resources
  const resourceError = processResources(
    diff.resources!,
    '$.resources',
    resources,
    warnings,
  );
  if (resourceError) {
    return resourceError;
  }

  // Flatten nested stacks
  if (diff.nestedStacks) {
    const nestedError = flattenNestedStacks(
      diff.nestedStacks,
      '$.nestedStacks',
      resources,
      warnings,
    );
    if (nestedError) {
      return nestedError;
    }
  }

  const manifest: ResourceChangeManifest = {
    version: '1.0',
    metadata: {
      submittedAt: new Date().toISOString(),
      sourceFormat: 'cdk',
      description: diff.stackName
        ? `CDK cloud assembly diff for stack "${diff.stackName}"`
        : undefined,
    },
    resources,
  };

  return { manifest, warnings };
}
