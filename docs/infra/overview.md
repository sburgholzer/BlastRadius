← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Infrastructure (packages/infra)

Where all the code from other packages gets deployed as real AWS resources. Uses AWS CDK (Cloud Development Kit) — you write TypeScript that describes infrastructure, and CDK converts it to CloudFormation templates that AWS deploys.

**Three files:**

**`src/constructs/analysis-pipeline.ts`** — The Step Functions state machine. The orchestrator that runs Lambda handlers in order.

```
Ingestion
  → Is format "canonical"?
      No → AdapterConversion → Discovery
      Yes → Discovery
  → Scoring
  → VisualizationPrep
  → Is enableSummary true?
      Yes → SummaryGeneration → Complete
      No → Complete
```

Each state invokes a Lambda and passes output to the next. If a state fails:
- Retryable error → wait 2s, retry (up to 3 times, doubling wait each time)
- Non-retryable error (validation, permission, not found) → immediately fail, no retry
- Whole pipeline timeout: 120 seconds

**`src/constructs/api-gateway.ts`** — The REST API that frontend and CLI talk to. Four endpoints, all requiring SigV4 authentication (AWS IAM credentials). 180-second timeout per endpoint.

**`src/stacks/blast-radius-stack.ts`** — The main stack that assembles everything. The wiring diagram. Creates:

- **14 Lambda functions** — each with appropriate memory (256MB–1024MB) and timeout (10s–90s)
- **2 DynamoDB tables** — adapter registry + analysis status
- **2 S3 buckets** — results (90-day expiration) + frontend (static assets)
- **1 Step Functions state machine** — the pipeline
- **1 API Gateway** — the REST API
- **1 CloudFront distribution** — serves frontend globally with HTTPS
- **14 CloudWatch log groups** — one per Lambda, 2-week retention
- **3 CloudWatch alarms** — pipeline failures, timeouts, API errors

**IAM permissions (least-privilege):** Each Lambda only gets access to what it needs. Resource Resolver can query Config but can't write to S3. Visualization Prep can write to S3 but can't query Config. Nobody gets `*` access to anything.

**Deployment:**
```bash
cd packages/infra
npx cdk deploy
```
That one command creates ~50 AWS resources, wires them together, and gives you a working system.
