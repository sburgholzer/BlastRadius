/**
 * CloudFormation Manifest Adapter.
 *
 * Converts AWS CloudFormation DescribeChangeSet output into a canonical
 * ResourceChangeManifest. Maps CloudFormation action types to canonical
 * modification types and extracts resource metadata.
 */

import type { ResourceChangeManifest, ResourceChange, ModificationType } from '@blast-radius/core';

/**
 * CloudFormation resource change detail from DescribeChangeSet output.
 */
export interface CloudFormationResourceChange {
  Action?: string;
  LogicalResourceId?: string;
  PhysicalResourceId?: string;
  ResourceType?: string;
  Replacement?: string;
  Scope?: string[];
  Details?: unknown[];
}

/**
 * A single change entry in the CloudFormation changeset.
 */
export interface CloudFormationChange {
  Type?: string;
  ResourceChange?: CloudFormationResourceChange;
}

/**
 * Simplified CloudFormation DescribeChangeSet output structure.
 */
export interface CloudFormationChangeset {
  ChangeSetName?: string;
  StackName?: string;
  Changes?: CloudFormationChange[];
}

/**
 * Error response returned when the changeset is malformed.
 */
export interface CloudFormationAdapterError {
  error: string;
  location?: string;
}

/**
 * Successful adapter output.
 */
export interface CloudFormationAdapterOutput {
  manifest: ResourceChangeManifest;
  warnings: string[];
}

/** Result type from the handler. */
export type CloudFormationAdapterResult = CloudFormationAdapterOutput | CloudFormationAdapterError;


/**
 * Maps a CloudFormation Action and Replacement value to a canonical ModificationType.
 *
 * Mapping rules:
 * - "Add" → "Add"
 * - "Modify" with Replacement "True" → "Replace"
 * - "Modify" with Replacement "False" or "Conditional" → "Modify"
 * - "Remove" → "Remove"
 * - "Import" → "Add"
 * - "Dynamic" → "Modify"
 */
export function mapActionToModificationType(action: string, replacement?: string): ModificationType {
  switch (action) {
    case 'Add':
      return 'Add';
    case 'Remove':
      return 'Remove';
    case 'Import':
      return 'Add';
    case 'Dynamic':
      return 'Modify';
    case 'Modify':
      if (replacement === 'True') {
        return 'Replace';
      }
      return 'Modify';
    default:
      return 'Modify';
  }
}

/**
 * Validates that the input has the expected CloudFormation changeset structure.
 * Returns an error with location if the input is malformed.
 */
function validateChangesetStructure(input: unknown): CloudFormationAdapterError | null {
  if (input === null || input === undefined) {
    return { error: 'Input is null or undefined', location: '$' };
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Input must be a non-array object', location: '$' };
  }

  const changeset = input as Record<string, unknown>;

  if (!('Changes' in changeset)) {
    return { error: 'Missing required field "Changes"', location: '$' };
  }

  if (!Array.isArray(changeset.Changes)) {
    return { error: '"Changes" must be an array', location: '$.Changes' };
  }

  return null;
}

/**
 * Validates a single change entry and returns an error if malformed.
 */
function validateChangeEntry(change: unknown, index: number): CloudFormationAdapterError | null {
  if (change === null || change === undefined || typeof change !== 'object') {
    return {
      error: `Change entry at index ${index} must be a non-null object`,
      location: `$.Changes[${index}]`,
    };
  }

  const entry = change as Record<string, unknown>;

  if (entry.Type !== 'Resource') {
    // Non-resource changes are skipped, not errors
    return null;
  }

  if (!entry.ResourceChange || typeof entry.ResourceChange !== 'object') {
    return {
      error: `Missing or invalid "ResourceChange" at index ${index}`,
      location: `$.Changes[${index}].ResourceChange`,
    };
  }

  const rc = entry.ResourceChange as Record<string, unknown>;

  if (!rc.Action || typeof rc.Action !== 'string') {
    return {
      error: `Missing or invalid "Action" at index ${index}`,
      location: `$.Changes[${index}].ResourceChange.Action`,
    };
  }

  if (!rc.ResourceType || typeof rc.ResourceType !== 'string') {
    return {
      error: `Missing or invalid "ResourceType" at index ${index}`,
      location: `$.Changes[${index}].ResourceChange.ResourceType`,
    };
  }

  if (!rc.LogicalResourceId || typeof rc.LogicalResourceId !== 'string') {
    return {
      error: `Missing or invalid "LogicalResourceId" at index ${index}`,
      location: `$.Changes[${index}].ResourceChange.LogicalResourceId`,
    };
  }

  return null;
}

/**
 * Converts a single CloudFormation resource change into a canonical ResourceChange.
 */
function convertResourceChange(rc: CloudFormationResourceChange): ResourceChange {
  const modificationType = mapActionToModificationType(rc.Action!, rc.Replacement);

  return {
    resourceType: rc.ResourceType!,
    resourceId: rc.PhysicalResourceId || rc.LogicalResourceId!,
    provider: 'aws',
    modificationType,
  };
}

/**
 * CloudFormation Manifest Adapter handler.
 *
 * Converts a CloudFormation DescribeChangeSet output into a canonical
 * ResourceChangeManifest.
 *
 * 1. Validates the input has the expected CloudFormation changeset structure.
 * 2. Extracts each resource change from the Changes array.
 * 3. Maps to canonical format.
 * 4. Returns error with location if input is malformed.
 */
export async function handler(event: unknown): Promise<CloudFormationAdapterResult> {
  // Validate top-level structure
  const structureError = validateChangesetStructure(event);
  if (structureError) {
    return structureError;
  }

  const changeset = event as CloudFormationChangeset;
  const resources: ResourceChange[] = [];
  const warnings: string[] = [];

  // Process each change entry
  for (let i = 0; i < changeset.Changes!.length; i++) {
    const change = changeset.Changes![i];

    // Validate the change entry
    const entryError = validateChangeEntry(change, i);
    if (entryError) {
      return entryError;
    }

    // Skip non-resource changes
    if ((change as CloudFormationChange).Type !== 'Resource') {
      warnings.push(`Skipping non-resource change at index ${i} (Type: "${(change as Record<string, unknown>).Type}")`);
      continue;
    }

    const rc = (change as CloudFormationChange).ResourceChange!;

    // Convert to canonical format
    resources.push(convertResourceChange(rc));
  }

  const manifest: ResourceChangeManifest = {
    version: '1.0',
    metadata: {
      submittedAt: new Date().toISOString(),
      sourceFormat: 'cloudformation',
      description: changeset.StackName
        ? `CloudFormation changeset "${changeset.ChangeSetName ?? 'unknown'}" for stack "${changeset.StackName}"`
        : undefined,
    },
    resources,
  };

  return { manifest, warnings };
}
