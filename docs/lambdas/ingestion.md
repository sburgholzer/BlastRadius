← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Ingestion Handler

**`ingestion/handler.ts`** — The validation gate of the pipeline. Runs after adapter conversion (if needed) to validate the canonical manifest.

**What it receives:**
```typescript
interface IngestionInput {
  analysisId?: string;          // from the API handler (reused if provided)
  manifest: unknown;            // raw JSON (could be anything at this point)
  requestingPrincipal: string;  // who submitted it (IAM ARN)
  sourceFormat: string;         // "canonical", "terraform-plan", etc.
  options?: Record<string, unknown>; // analysis options (enableSummary, threshold, etc.)
  originatingAccountId?: string;
}
```

**What it does (4 steps):**
1. **Validate** — calls `validateManifest()`. Malformed → 400 error with JSON path. Too large → 413.
2. **Flatten** — calls `flattenHierarchy()`. Groups nested >10 levels → 400 error.
3. **Build clean manifest** — creates a `ResourceChangeManifest` without groups (flat list only).
4. **Generate or reuse analysis ID** — uses the provided `analysisId` if available, otherwise `crypto.randomUUID()`.

**On success:** Returns `{ analysisId, sourceFormat, validatedManifest, resourceCount, options }`

The output passes through `analysisId`, `sourceFormat`, and `options` so downstream pipeline steps can access them. The Step Functions `outputPath: '$.Payload'` replaces the entire state with the Lambda's return value, so anything not returned here is lost.

**On failure:** Returns `{ statusCode: 400|413, error: "message", path?: "resources[3].resourceType" }`

**Key insight:** This handler does zero AWS calls. It's pure validation and data transformation. Validation failures are fast and cheap — milliseconds, not seconds.

**Pipeline position:** Runs AFTER adapter conversion. The pipeline flow is:
```
NeedsAdapterConversion? → (AdapterConversion → PrepareAfterAdapter →) Ingestion → ProgressUpdate → Discovery → ...
```

**Dependency injection:**
```typescript
export async function handler(event: IngestionInput, deps?: IngestionDeps): Promise<IngestionResult>
```
Uses `deps && 'validate' in deps ? deps : createDefaultDeps()` to distinguish test mocks from the Lambda Context object.
