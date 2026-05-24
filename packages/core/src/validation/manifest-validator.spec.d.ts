/**
 * Property-based tests for schema validation rejection with correct error paths.
 *
 * Feature: blast-radius-visualizer, Property 2: Schema Validation Rejects Invalid Manifests with Correct Error Path
 *
 * Validates: Requirements 1.2, 1.6
 *
 * For any ResourceChangeManifest containing at least one schema violation
 * (missing required field, invalid type, or invalid enum value), the Manifest
 * Ingestion Service SHALL reject the entire manifest and return an error
 * indicating the JSON path of the first violation.
 */
export {};
//# sourceMappingURL=manifest-validator.spec.d.ts.map