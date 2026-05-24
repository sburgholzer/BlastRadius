← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Ingestion Handler

**`ingestion/handler.ts`** — The front door of the pipeline. First Lambda that runs when someone submits a manifest.

**What it receives:**
```typescript
interface IngestionInput {
  manifest: unknown;           // raw JSON (could be anything at this point)
  requestingPrincipal: string; // who submitted it (IAM ARN)
  sourceFormat: string;        // "canonical", "terraform-plan", etc.
}
```

**What it does (4 steps):**
1. **Validate** — calls `validateManifest()`. Malformed → 400 error with JSON path. Too large → 413.
2. **Flatten** — calls `flattenHierarchy()`. Groups nested >10 levels → 400 error.
3. **Build clean manifest** — creates a `ResourceChangeManifest` without groups (flat list only).
4. **Generate analysis ID** — `crypto.randomUUID()` that identifies this analysis throughout the pipeline.

**On success:** Returns `{ analysisId, validatedManifest, resourceCount }`

**On failure:** Returns `{ statusCode: 400|413, error: "message", path?: "resources[3].resourceType" }`

**Key insight:** This handler does zero AWS calls. It's pure validation and data transformation. Validation failures are fast and cheap — milliseconds, not seconds.

**Why `manifest: unknown`?** At this point we don't trust the input. It could be garbage JSON, a string, null. The validator's job is to *prove* it matches the expected shape before anything else touches it.
