← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Risk Summary Generator

**`risk-summary/handler.ts`** — Generates a natural language summary of the blast radius analysis using Amazon Bedrock.

**What it does:**
1. Checks feature flag (`ENABLE_BEDROCK_SUMMARY` or `ENABLE_BEDROCK` env var)
2. If disabled → returns `{ skipped: true }`, pipeline continues
3. Selects the top 3 highest-scoring resources
4. Builds a prompt with resource details and risk summary
5. Invokes Bedrock (Claude Haiku 4.5 via inference profile)
6. Enforces 500-word limit on the response
7. **Writes the summary back to S3** — reads the existing `visualization.json`, appends `naturalLanguageSummary`, writes it back
8. Returns `{ summary, generationDurationMs, skipped: false }`

**Input from the pipeline:**
```typescript
interface SummaryInput {
  analysisId: string;
  scoredResources: ScoredResource[];
  riskSummary: RiskSummary;
  manifest: ResourceChangeManifest;
  enableSummary?: boolean;
}
```

**Feature flags (dual check):**
```typescript
const flag = process.env.ENABLE_BEDROCK_SUMMARY ?? process.env.ENABLE_BEDROCK;
return flag === 'true' || flag === '1';
```

This allows the CDK stack to set either env var. The `ENABLE_BEDROCK` prop on the stack controls both.

**Model configuration:**
- Default: `anthropic.claude-haiku-4-5-20251001-v1:0`
- Override via: `BEDROCK_MODEL_ID` env var
- Production uses inference profile: `global.anthropic.claude-haiku-4-5-20251001-v1:0`

**Why inference profiles?** Bedrock requires newer models to be invoked via inference profiles rather than direct model IDs. The profile format is `us.anthropic.claude-*` or `global.anthropic.claude-*`.

**S3 write-back:** After generating the summary, the Lambda reads the existing `analyses/{analysisId}/visualization.json` from S3, adds the `naturalLanguageSummary` field, and writes it back. This is best-effort — if S3 fails, the pipeline still succeeds (just without the summary in the stored results).

**Timeout:** 30 seconds total (15s for Bedrock + overhead for S3 read/write). The pipeline's retry policy handles transient failures.

**Graceful degradation:** On any failure (Bedrock timeout, access denied, empty response), returns `{ skipped: false, error: "message" }` instead of throwing. The pipeline continues normally.

**IAM permissions:**
- `bedrock:InvokeModel` on `foundation-model/*` and `inference-profile/*`
- S3 read/write on the results bucket

**Pipeline position:** Runs conditionally after VisualizationPrep:
```
VisualizationPrep → NeedsSummaryGeneration?
  ├─ options.enableSummary = true → SummaryGeneration → MarkComplete
  └─ otherwise → MarkComplete
```

The `NeedsSummaryGeneration` choice uses `Condition.and(isPresent(...), booleanEquals(...))` to gracefully skip if the field is missing (rather than crashing the pipeline).
