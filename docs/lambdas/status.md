← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Status Handler

**`status/handler.ts`** — A DynamoDB read/write handler that tracks where the analysis pipeline is at any given moment.

**Two operations:**

**Update (called by the pipeline):** Each Step Functions stage reports progress.
```typescript
{ operation: "update", analysisId: "abc-123", status: "running", currentStage: "Discovery", progressPercentage: 40 }
```

Required fields: `analysisId`, `status`, `currentStage`, `progressPercentage`.
Optional fields: `requestingPrincipal`, `originatingAccountId`, `resultLocation`.

The update expression is built dynamically — only includes fields that are actually provided. This allows the error handler to call it with minimal data (just `analysisId` + `status` + `currentStage` + `progressPercentage`) without needing identity fields.

**Get (called by the frontend/API):** The UI polls this every 2 seconds to show the progress bar.
```typescript
{ operation: "get", analysisId: "abc-123" }
// → { status: "running", currentStage: "Discovery", progressPercentage: 40, elapsedTimeMs: 5200 }
```

**`elapsedTimeMs` is computed on the fly** — stores `startedAt` once (on first update), then calculates elapsed time from that timestamp whenever someone calls `get`. No need to update it every second.

**Error handling in the pipeline:** When any pipeline step fails (after retries), the Step Functions `UpdateStatusFailed` state invokes this handler to mark the analysis as `failed`. This ensures the frontend never shows a permanently stuck "running" state. The error path is:

```
Any task failure (States.ALL) → UpdateStatusFailed (status Lambda: marks "failed") → PipelineFailed (Fail state)
```

**Environment variable:** Reads table name from `ANALYSIS_STATUS_TABLE` env var (set by CDK), with fallback to `STATUS_TABLE` for backward compatibility.

**Dynamic UpdateExpression:** The handler builds the DynamoDB UpdateExpression at runtime based on which fields are present in the event. Example — a normal progress update sets 5+ attributes, but the error handler only sets `status`, `currentStage`, `progressPercentage`, and `updatedAt`.

**Dependency injection:**
```typescript
export async function handler(event: StatusInput, deps?: StatusDeps): Promise<StatusResult>
```
Uses `deps && 'dynamoClient' in deps ? deps : createDefaultDeps()` to distinguish test mocks from the Lambda Context.

**Why a separate Lambda:** The Step Functions state machine needs to update status between stages. Dedicated Lambda means any stage can call it without coupling to DynamoDB directly.
