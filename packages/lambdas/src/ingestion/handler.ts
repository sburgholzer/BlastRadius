/**
 * Manifest Ingestion Service Lambda handler.
 *
 * Orchestrates manifest validation, hierarchy flattening, and analysis ID generation.
 * Returns structured output with the validated/flattened manifest and resource count,
 * or an error response with appropriate HTTP status codes.
 */

import { randomUUID } from 'node:crypto';
import { validateManifest, flattenHierarchy } from '@blast-radius/core';
import type { ResourceChangeManifest } from '@blast-radius/core';

export interface IngestionInput {
  analysisId?: string;
  manifest: unknown;
  requestingPrincipal: string;
  sourceFormat: string;
  options?: Record<string, unknown>;
  originatingAccountId?: string;
}

export interface IngestionOutput {
  analysisId: string;
  sourceFormat: string;
  validatedManifest: ResourceChangeManifest;
  resourceCount: number;
  options?: Record<string, unknown>;
}

export interface ErrorResponse {
  statusCode: number;
  error: string;
  path?: string;
}

/**
 * Determines whether a validation error indicates a payload-too-large condition (413).
 */
function isPayloadTooLarge(error: string): boolean {
  return error.includes('Payload size exceeds maximum') || error.includes('must not exceed 200 entries');
}

/**
 * Manifest Ingestion Service handler.
 *
 * 1. Validates the manifest against the canonical schema.
 * 2. Flattens any hierarchical group structure.
 * 3. Generates a unique analysis ID.
 * 4. Returns the flattened manifest with resource count.
 */
export async function handler(event: IngestionInput): Promise<IngestionOutput | ErrorResponse> {
  // Step 1: Validate the manifest
  const validationResult = validateManifest(event.manifest);

  if (!validationResult.success) {
    const statusCode = isPayloadTooLarge(validationResult.error) ? 413 : 400;
    return {
      statusCode,
      error: validationResult.error,
      ...(validationResult.path !== undefined && { path: validationResult.path }),
    };
  }

  const validatedManifest = validationResult.manifest;

  // Step 2: Flatten hierarchy
  const flattenResult = flattenHierarchy(validatedManifest);

  if (!flattenResult.success) {
    return {
      statusCode: 400,
      error: flattenResult.error,
      path: flattenResult.path,
    };
  }

  // Step 3: Build the flattened manifest (replace resources with the flat list, remove groups)
  const flattenedManifest: ResourceChangeManifest = {
    version: validatedManifest.version,
    metadata: validatedManifest.metadata,
    resources: flattenResult.resources,
  };

  // Step 4: Generate analysis ID and return output
  const analysisId = event.analysisId ?? randomUUID();

  return {
    analysisId,
    sourceFormat: event.sourceFormat,
    validatedManifest: flattenedManifest,
    resourceCount: flattenResult.resources.length,
    ...(event.options && { options: event.options }),
  };
}
