/**
 * Adapter system data models.
 *
 * Defines the interfaces for the adapter registry and individual manifest
 * adapters that convert native IaC changesets into the canonical format.
 */

import type { ResourceChangeManifest } from './manifest';

/** A registered adapter entry stored in DynamoDB. */
export interface AdapterRegistryEntry {
  formatId: string;
  adapterLambdaArn: string;
  displayName: string;
  version: string;
  registeredAt: string;
}

/** Interface that each manifest adapter must implement. */
export interface ManifestAdapter {
  convert(nativeChangeset: unknown): ResourceChangeManifest;
  supportedFormat(): string;
}

/** Input to the Adapter Registry Lambda. */
export interface AdapterRegistryInput {
  format: string;
  payload: unknown;
}

/** Metadata about the adapter conversion process. */
export interface AdapterMetadata {
  adapterName: string;
  conversionDurationMs: number;
  warnings: string[];
}

/** Output from the Adapter Registry Lambda. */
export interface AdapterRegistryOutput {
  manifest: ResourceChangeManifest;
  adapterMetadata: AdapterMetadata;
}
