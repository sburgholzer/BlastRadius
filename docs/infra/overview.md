← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Infrastructure (packages/infra)

Where all the code from other packages gets deployed as real AWS resources. Uses AWS CDK (Cloud Development Kit) — you write TypeScript that describes infrastructure, and CDK converts it to CloudFormation templates that AWS deploys.

**Three constructs + one stack:**

## `src/constructs/analysis-pipeline.ts`

The Step Functions state machine. The orchestrator that runs Lambda handlers in order.

```
NeedsAdapterConversion? (checks $.sourceFormat)
  ├─ Not "canonical" → AdapterConversion → PrepareAfterAdapter → Ingestion
  └─ "canonical" → Ingestion
→ ProgressUpdate (20%)
→ Discovery (resultPath: $.discoveryResult)
→ ProgressUpdate (40%)
→ Scoring (resultPath: $.scoringResult)
→ ProgressUpdate (60%)
→ VisualizationPrep (resultPath: $.visualizationResult)
→ ProgressUpdate (80%)
→ NeedsSummaryGeneration?
    ├─ enableSummary = true → SummaryGeneration → MarkAnalysisComplete
    └─ otherwise → MarkAnalysisComplete
→ ProgressUpdate (100%)
→ Complete
```

**Key design decisions:**

- The adapter choice runs FIRST (before ingestion) because `$.sourceFormat` is only available in the original input. After ingestion runs, the state is replaced by its output.
- `AdapterConversion` uses `payload` + `resultPath` to send `{ format, payload }` to the adapter while preserving the original state at `$.adapterResult`.
- `PrepareAfterAdapter` is a Pass state that reshapes the adapter output back into the shape ingestion expects.
- Discovery, Scoring, and VisualizationPrep use `resultPath` (not `outputPath`) to preserve existing state while adding their results to the state object.

**Payload mappings between stages:**

| Stage | Receives |
|-------|----------|
| Ingestion | The full state (manifest, sourceFormat, options) |
| Discovery | `$.validatedManifest` from ingestion output |
| Scoring | `{ dependencyGraph: $.discoveryResult.dependencyGraph, manifest: $.validatedManifest }` |
| VisualizationPrep | `{ analysisId, dependencyGraph, scoredResources, riskSummary, manifest }` |
| SummaryGeneration | `{ analysisId, scoredResources, riskSummary, manifest }` |

**NeedsSummaryGeneration condition:** Uses `Condition.and(isPresent('$.options.enableSummary'), booleanEquals('$.options.enableSummary', true))` — the `isPresent` check prevents a crash when the `options` or `enableSummary` field is missing entirely.

**Error handling:**
- Retryable errors → wait 2s, retry (up to 3 times, exponential backoff)
- ALL task failures catch `States.ALL` → `UpdateStatusFailed` (invokes the status Lambda to mark analysis as "failed" in DynamoDB) → `PipelineFailed` (Fail state terminates execution)
- Pipeline timeout: 120 seconds

## `src/constructs/api-gateway.ts`

The REST API that frontend and CLI talk to. Five endpoints:
- `POST /analyze` — Submit a changeset for analysis
- `GET /analyze/{analysisId}` — Get analysis status/results
- `GET /analyze/{analysisId}/export` — Export as JSON/PDF
- `GET /formats` — List supported adapter formats
- `GET /analyses` — List all analyses

Supports both IAM (SigV4) auth and no-auth mode (for demos). CORS is enabled when auth is disabled.

## `src/stacks/blast-radius-stack.ts`

The main stack that assembles everything. Creates:

- **14 Lambda functions** — each with appropriate memory (256MB–1024MB) and timeout (10s–90s)
- **2 DynamoDB tables** — adapter registry + analysis status
- **2 S3 buckets** — results (90-day expiration) + frontend (static assets)
- **1 Step Functions state machine** — the pipeline
- **1 API Gateway** — the REST API
- **1 CloudFront distribution** — serves frontend globally with HTTPS
- **14 CloudWatch log groups** — one per Lambda, 2-week retention
- **3 CloudWatch alarms** — pipeline failures, timeouts, API errors
- **Runtime config** — deploys `config.json` to the frontend S3 bucket with the API URL

**Adapter registry seeding:** On deploy, the stack automatically seeds the DynamoDB adapter registry table with entries for `cloudformation`, `terraform-plan`, and `cdk` adapters using `AwsCustomResource`. Uses unconditional `putItem` so it's idempotent on redeploys.

**Frontend runtime config:** A `config.json` file is deployed to the frontend S3 bucket containing `{ "apiBaseUrl": "<API Gateway URL>" }`. The frontend loads this at runtime to know which API to call — works for both auth and no-auth modes without needing to rebuild the frontend.

**Notable Lambda configurations:**

| Lambda | Extra Config |
|--------|-------------|
| Resource Resolver | `CONFIG_AGGREGATOR_NAME` env var for AWS Config queries |
| Risk Summary | `ENABLE_BEDROCK_SUMMARY`, `BEDROCK_MODEL_ID` env vars, 30s timeout, read/write on results bucket |
| Risk Summary | Bedrock IAM policy covers `foundation-model/*` and `inference-profile/*` ARNs |

**IAM permissions (least-privilege):** Each Lambda only gets access to what it needs. Resource Resolver can query Config but can't write to S3. Visualization Prep can write to S3 but can't query Config. Risk Summary can read and write S3 (to append summaries to visualization.json). Nobody gets `*` access to anything.

**Deployment:**
```bash
cd packages/infra
npm run build
npx cdk deploy
```
That creates ~50 AWS resources, wires them together, and gives you a working system.
