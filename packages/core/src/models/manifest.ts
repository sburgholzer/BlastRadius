/**
 * Canonical Resource Change Manifest data models.
 *
 * The manifest is the tool-neutral representation of proposed infrastructure
 * modifications. Adapters convert native IaC formats into this canonical form.
 */

/** Supported modification types for resource changes. */
export type ModificationType = 'Add' | 'Modify' | 'Remove' | 'Replace';

/** Metadata about the manifest submission. */
export interface ManifestMetadata {
  submittedAt: string;
  sourceFormat: string;
  description?: string;
}

/** A single resource change entry in the manifest. */
export interface ResourceChange {
  resourceType: string;
  resourceId: string;
  provider: string;
  modificationType: ModificationType;
  region?: string;
  accountId?: string;
  properties?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
}

/** A hierarchical grouping of resources (recursive). */
export interface ManifestGroup {
  name: string;
  resources: ResourceChange[];
  groups?: ManifestGroup[];
}

/** The canonical Resource Change Manifest schema. */
export interface ResourceChangeManifest {
  version: string;
  metadata: ManifestMetadata;
  resources: ResourceChange[];
  groups?: ManifestGroup[];
}
