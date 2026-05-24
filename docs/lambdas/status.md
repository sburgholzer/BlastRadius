← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Status Handler

**`status/handler.ts`** — A simple DynamoDB read/write handler that tracks where the analysis pipeline is at any given moment.

**Two operations:**

**Update (called by the pipeline):** Each Step Functions stage reports progress.
```typescript
{ operation: "update", analysisId: "abc-123", status: "running", currentStage: "Discovery", progressPercentage: 40 }
```

**Get (called by the frontend/API):** The UI polls this every 2 seconds to show the progress bar.
```typescript
{ operation: "get", analysisId: "abc-123" }
// → { status: "running", currentStage: "Discovery", progressPercentage: 40, elapsedTimeMs: 5200 }
```

**`elapsedTimeMs` is computed on the fly** — stores `startedAt` once (on first update), then calculates elapsed time from that timestamp whenever someone calls `get`. No need to update it every second.

**Tags results with identity** — every record includes `requestingPrincipal` and `originatingAccountId` so the results handler can enforce authorization later.

**Why a separate Lambda:** The Step Functions state machine needs to update status between stages. Dedicated Lambda means any stage can call it without coupling to DynamoDB directly.
