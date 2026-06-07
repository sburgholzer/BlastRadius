/**
 * Terraform Manifest Adapter.
 *
 * Converts Terraform plan JSON output (from `terraform show -json`) into a
 * canonical ResourceChangeManifest. Handles action mapping, provider extraction,
 * and before/after property preservation.
 */

import type { ResourceChangeManifest, ResourceChange, ModificationType } from '@blast-radius/core';

/** Terraform plan JSON structure (subset relevant to conversion). */
export interface TerraformPlan {
  format_version: string;
  terraform_version: string;
  resource_changes: TerraformResourceChange[];
}

/** A single resource change entry in the Terraform plan. */
export interface TerraformResourceChange {
  address: string;
  type: string;
  name: string;
  provider_name: string;
  change: TerraformChange;
}

/** The change block within a Terraform resource change. */
export interface TerraformChange {
  actions: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** Error response returned when parsing fails. */
export interface TerraformAdapterError {
  error: string;
  location?: string;
}

/** Successful conversion result. */
export interface TerraformAdapterOutput {
  manifest: ResourceChangeManifest;
  warnings: string[];
}

/** Result type from the handler. */
export type TerraformAdapterResult = TerraformAdapterOutput | TerraformAdapterError;

/**
 * Maps Terraform action arrays to canonical ModificationType.
 * Returns undefined for actions that should be skipped (no-op, read).
 */
function mapActions(actions: string[]): ModificationType | undefined {
  if (actions.length === 1) {
    switch (actions[0]) {
      case 'create':
        return 'Add';
      case 'update':
        return 'Modify';
      case 'delete':
        return 'Remove';
      case 'no-op':
      case 'read':
        return undefined;
      default:
        return undefined;
    }
  }

  if (actions.length === 2) {
    const sorted = [...actions].sort();
    if (sorted[0] === 'create' && sorted[1] === 'delete') {
      return 'Replace';
    }
  }

  return undefined;
}

/**
 * Extracts a canonical provider identifier from a Terraform provider_name.
 *
 * Known mappings:
 * - "registry.terraform.io/hashicorp/aws" → "aws"
 * - "registry.terraform.io/hashicorp/azurerm" → "azure"
 * - "registry.terraform.io/hashicorp/google" → "gcp"
 * - Others → last segment of the provider name
 */
function mapProvider(providerName: string): string {
  const knownProviders: Record<string, string> = {
    'registry.terraform.io/hashicorp/aws': 'aws',
    'registry.terraform.io/hashicorp/azurerm': 'azure',
    'registry.terraform.io/hashicorp/google': 'gcp',
  };

  if (knownProviders[providerName]) {
    return knownProviders[providerName];
  }

  // Extract the last segment of the provider name
  const segments = providerName.split('/');
  return segments[segments.length - 1] ?? providerName;
}

/**
 * Validates that the input has the expected Terraform plan structure.
 */
function validateTerraformPlan(input: unknown): input is TerraformPlan {
  if (input === null || typeof input !== 'object') {
    return false;
  }

  const plan = input as Record<string, unknown>;

  if (typeof plan.format_version !== 'string') {
    return false;
  }

  if (!Array.isArray(plan.resource_changes)) {
    return false;
  }

  return true;
}

/**
 * Validates a single resource change entry.
 * Returns an error message if invalid, or undefined if valid.
 */
function validateResourceChange(
  entry: unknown,
  index: number,
): string | undefined {
  if (entry === null || typeof entry !== 'object') {
    return `resource_changes[${index}]: expected an object`;
  }

  const rc = entry as Record<string, unknown>;

  if (typeof rc.address !== 'string' || rc.address.length === 0) {
    return `resource_changes[${index}].address: must be a non-empty string`;
  }

  if (typeof rc.type !== 'string' || rc.type.length === 0) {
    return `resource_changes[${index}].type: must be a non-empty string`;
  }

  if (typeof rc.provider_name !== 'string' || rc.provider_name.length === 0) {
    return `resource_changes[${index}].provider_name: must be a non-empty string`;
  }

  if (rc.change === null || typeof rc.change !== 'object') {
    return `resource_changes[${index}].change: must be an object`;
  }

  const change = rc.change as Record<string, unknown>;

  if (!Array.isArray(change.actions) || change.actions.length === 0) {
    return `resource_changes[${index}].change.actions: must be a non-empty array`;
  }

  for (let i = 0; i < change.actions.length; i++) {
    if (typeof change.actions[i] !== 'string') {
      return `resource_changes[${index}].change.actions[${i}]: must be a string`;
    }
  }

  return undefined;
}

/**
 * Terraform Manifest Adapter handler.
 *
 * 1. Validates the input has the expected Terraform plan structure.
 * 2. Iterates over resource_changes.
 * 3. Maps each entry to canonical ResourceChange format.
 * 4. Skips no-op and read actions.
 * 5. Returns error with location for malformed input.
 */
export async function handler(event: unknown): Promise<TerraformAdapterResult> {
  // Validate top-level structure
  if (!validateTerraformPlan(event)) {
    const detail = event === null || typeof event !== 'object'
      ? 'input must be a JSON object'
      : !('format_version' in (event as Record<string, unknown>))
        ? 'missing required field "format_version"'
        : !Array.isArray((event as Record<string, unknown>).resource_changes)
          ? 'missing or invalid "resource_changes" array'
          : 'invalid Terraform plan structure';

    return {
      error: `Invalid Terraform plan JSON: ${detail}`,
      location: 'root',
    };
  }

  const plan = event as TerraformPlan;
  const resources: ResourceChange[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < plan.resource_changes.length; i++) {
    const entry = plan.resource_changes[i];

    // Validate individual resource change
    const validationError = validateResourceChange(entry, i);
    if (validationError) {
      return {
        error: `Malformed resource change: ${validationError}`,
        location: `resource_changes[${i}]`,
      };
    }

    const rc = entry as TerraformResourceChange;

    // Map actions to canonical modification type
    const modificationType = mapActions(rc.change.actions);

    // Skip no-op and read actions
    if (modificationType === undefined) {
      continue;
    }

    // Build properties from before/after if present
    const properties: ResourceChange['properties'] = {};
    if (rc.change.before !== null && rc.change.before !== undefined) {
      properties.before = rc.change.before;
    }
    if (rc.change.after !== null && rc.change.after !== undefined) {
      properties.after = rc.change.after;
    }

    const resource: ResourceChange = {
      resourceType: rc.type,
      resourceId: rc.address,
      provider: mapProvider(rc.provider_name),
      modificationType,
      ...(Object.keys(properties).length > 0 && { properties }),
    };

    resources.push(resource);
  }

  const manifest: ResourceChangeManifest = {
    version: '1.0',
    metadata: {
      submittedAt: new Date().toISOString(),
      sourceFormat: 'terraform-plan',
      description: `Converted from Terraform ${plan.terraform_version ?? 'unknown'} plan (format ${plan.format_version})`,
    },
    resources,
  };

  return {
    manifest,
    warnings,
  };
}
