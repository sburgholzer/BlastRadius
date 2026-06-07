# @blast-radius/infra

AWS CDK infrastructure for the Blast Radius Pre-Deploy Visualizer. Defines all cloud resources as code including Lambda functions, DynamoDB tables, S3 buckets, API Gateway, Step Functions, CloudFront, and observability.

## Prerequisites

- Node.js 22+
- AWS CDK CLI (`npm install -g aws-cdk`)
- AWS credentials configured (`aws configure` or environment variables)
- Bootstrapped CDK environment (`cdk bootstrap aws://ACCOUNT/REGION`)
- **AWS Config** enabled and recording all resource types (or at minimum: EC2, RDS, Lambda, ECS, ELB, S3, IAM, VPC)
- **AWS Config Aggregator** created (required for Advanced Queries)
- **Resource Explorer** index active in the deployment region
- **Amazon Bedrock** model access for Claude 4.5 Haiku (optional, for AI summaries)

See the [root README prerequisites](../../README.md#prerequisites) for setup commands.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CloudFront                                    │
│                    (SPA routing, HTTPS)                               │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  S3 Bucket  │ (Frontend static assets)
                    └─────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    API Gateway (REST, SigV4)                          │
│  POST /analyze  │  GET /analyze/{id}  │  GET /.../export  │  GET /formats │
└────────┬────────────────┬──────────────────┬──────────────────┬─────┘
         │                │                  │                  │
    ┌────▼────┐     ┌────▼────┐       ┌────▼────┐       ┌────▼────┐
    │ Analyze │     │ Status  │       │ Results │       │ Formats │
    │ Lambda  │     │ Lambda  │       │ Lambda  │       │ Lambda  │
    └────┬────┘     └────┬────┘       └────┬────┘       └─────────┘
         │               │                  │
         ▼               ▼                  ▼
┌─────────────┐  ┌─────────────┐   ┌─────────────┐
│Step Functions│  │  DynamoDB   │   │  S3 Bucket  │
│   Pipeline  │  │(Status Tbl) │   │  (Results)  │
└──────┬──────┘  └─────────────┘   └─────────────┘
       │
       ▼ (orchestrates)
┌──────────────────────────────────────────────────────┐
│ Ingestion → Adapter → Resolver → Scorer → Viz → Summary │
└──────────────────────────────────────────────────────┘
```

---

## Constructs

### AnalysisPipeline

Step Functions state machine orchestrating the end-to-end analysis workflow.

**States:**
```
Ingestion → [NeedsAdapterConversion?] → Discovery → Scoring → VisualizationPrep → [NeedsSummaryGeneration?] → Complete
```

**Conditional logic:**
- Adapter conversion runs only when `sourceFormat !== 'canonical'`
- Summary generation runs only when `enableSummary === true`

**Retry policy (per state):**
- Max attempts: 3
- Interval: 2 seconds
- Backoff rate: 2× (exponential: 2s → 4s → 8s)
- Max delay: 30 seconds
- Retryable: States.TaskFailed, States.Timeout, Lambda.ServiceException, Lambda.TooManyRequestsException

**Error handling:**
- Non-retryable errors (ValidationError, PermissionDenied, ResourceNotFound) → immediate Fail state
- Pipeline timeout: 120 seconds total

**Props:**
```typescript
interface AnalysisPipelineProps {
  ingestionFunction: lambda.IFunction;
  adapterRegistryFunction: lambda.IFunction;
  resourceResolverFunction: lambda.IFunction;
  riskAssessorFunction: lambda.IFunction;
  visualizationPrepFunction: lambda.IFunction;
  riskSummaryFunction: lambda.IFunction;
  statusFunction: lambda.IFunction;
}
```

---

### BlastRadiusApiGateway

REST API with IAM (SigV4) authentication on all endpoints.

**Endpoints:**

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/analyze` | Analyze Lambda | Submit manifest for analysis |
| GET | `/analyze/{analysisId}` | Status Lambda | Get analysis status/results |
| GET | `/analyze/{analysisId}/export` | Results Lambda | Export results (JSON/PDF) |
| GET | `/formats` | Formats Lambda | List supported adapter formats |

**Configuration:**
- Authentication: IAM (SigV4) on all methods
- Stage: `v1`
- Integration timeout: 180 seconds
- Throttling: 100 requests/sec steady, 200 burst

**Props:**
```typescript
interface BlastRadiusApiGatewayProps {
  analyzeFunction: lambda.IFunction;
  statusFunction: lambda.IFunction;
  exportFunction: lambda.IFunction;
  formatsFunction: lambda.IFunction;
}
```

---

## BlastRadiusStack

The complete stack assembling all resources.

### Lambda Functions (14 total)

| Function | Memory | Timeout | Description |
|----------|--------|---------|-------------|
| BlastRadius-Ingestion | 256 MB | 30s | Validate and ingest manifests |
| BlastRadius-AdapterRegistry | 256 MB | 30s | Route to format adapters |
| BlastRadius-Adapter-CloudFormation | 256 MB | 30s | CloudFormation adapter |
| BlastRadius-Adapter-Terraform | 256 MB | 30s | Terraform adapter |
| BlastRadius-Adapter-CDK | 256 MB | 30s | CDK adapter |
| BlastRadius-ResourceResolver | 1024 MB | 90s | Dependency discovery |
| BlastRadius-RiskAssessor | 512 MB | 30s | Impact scoring |
| BlastRadius-VisualizationPrep | 512 MB | 30s | Graph visualization prep |
| BlastRadius-RiskSummary | 256 MB | 15s | Bedrock summary generation |
| BlastRadius-Status | 256 MB | 10s | Status tracking |
| BlastRadius-FailureHandler | 256 MB | 30s | Pipeline failure handling |
| BlastRadius-Results | 256 MB | 30s | Result retrieval |
| BlastRadius-Analyze | 256 MB | 30s | API entry point |
| BlastRadius-Formats | 128 MB | 10s | List supported formats |

All functions use: Node.js 22, ARM64 architecture, X-Ray tracing enabled.

### DynamoDB Tables (2)

**BlastRadius-AdapterRegistry**
| Attribute | Type | Role |
|-----------|------|------|
| `formatId` | String | Partition key |

- Billing: Pay-per-request
- Point-in-time recovery: Enabled
- Removal policy: RETAIN

**BlastRadius-AnalysisStatus**
| Attribute | Type | Role |
|-----------|------|------|
| `analysisId` | String | Partition key |
| `requestingPrincipal` | String | GSI partition key |
| `startedAt` | String | GSI sort key |

- Billing: Pay-per-request
- Point-in-time recovery: Enabled
- TTL attribute: `ttl`
- GSI: `byPrincipal` (requestingPrincipal + startedAt)
- Removal policy: RETAIN

### S3 Buckets

**Results Bucket** (`blast-radius-results-{account}-{region}`)
- Encryption: S3-managed (SSE-S3)
- Public access: Blocked
- SSL: Enforced
- Lifecycle: Results expire after configurable days (default 90)
- Multipart upload abort: 1 day
- Removal policy: RETAIN

**Frontend Bucket** (`blast-radius-frontend-{account}-{region}`)
- Encryption: S3-managed (SSE-S3)
- Public access: Blocked
- SSL: Enforced
- Removal policy: DESTROY (auto-delete objects)

### CloudFront Distribution

- Origin: Frontend S3 bucket via OAI
- Protocol: HTTPS redirect
- Cache policy: CACHING_OPTIMIZED
- Default root object: `index.html`
- SPA routing: 403/404 → `/index.html` (200 response)

### IAM Policies (Least-Privilege)

| Function | Permissions |
|----------|-------------|
| Ingestion | DynamoDB write (status table) |
| Adapter Registry | DynamoDB read (registry table), Lambda invoke (adapters) |
| Resource Resolver | Config:SelectAggregateResourceConfig, Config:SelectResourceConfig, Config:GetResourceConfigHistory, Config:ListDiscoveredResources, ResourceExplorer2:Search, ResourceExplorer2:GetView |
| Visualization Prep | S3 write (results bucket) |
| Risk Summary | S3 write (results bucket), Bedrock:InvokeModel (conditional) |
| Status | DynamoDB read/write (status table) |
| Failure Handler | S3 write (results bucket), DynamoDB write (status table) |
| Results | S3 read (results bucket), DynamoDB read (status table) |
| Analyze | Step Functions startExecution, DynamoDB write (status), DynamoDB read (registry) |
| Formats | DynamoDB read (registry table) |
| State Machine | Lambda invoke (all pipeline functions) |

### CloudWatch

**Log Groups:** One per Lambda function, 2-week retention, auto-cleanup.

**Alarms:**
| Alarm | Metric | Threshold | Period |
|-------|--------|-----------|--------|
| PipelineExecutionsFailed | State machine failed executions | ≥ 1 | 5 min |
| PipelineExecutionsTimedOut | State machine timed-out executions | ≥ 1 | 5 min |
| AnalyzeFunctionErrors | Analyze Lambda errors | ≥ 5 | 5 min |

---

## Stack Configuration

```typescript
interface BlastRadiusStackProps extends cdk.StackProps {
  /** Enable Bedrock-powered risk summaries. Default: false */
  enableBedrockSummary?: boolean;
  /** S3 results lifecycle expiration in days. Default: 90 */
  resultsRetentionDays?: number;
}
```

**Usage:**
```typescript
import { BlastRadiusStack } from '@blast-radius/infra';

const app = new cdk.App();

new BlastRadiusStack(app, 'BlastRadiusStack', {
  env: { account: '123456789012', region: 'us-east-1' },
  enableBedrockSummary: true,
  resultsRetentionDays: 30,
});
```

---

## Deployment

```bash
# Build all packages
npm run build

# Synthesize CloudFormation template
cdk synth

# Deploy the stack
cdk deploy

# Deploy with Bedrock enabled
cdk deploy --context enableBedrockSummary=true

# Diff changes before deploying
cdk diff

# Destroy the stack (caution: RETAIN policies protect data)
cdk destroy
```

---

## Stack Outputs

| Output | Description |
|--------|-------------|
| `ApiUrl` | API Gateway endpoint URL |
| `ResultsBucketName` | S3 bucket for analysis results |
| `FrontendBucketName` | S3 bucket for frontend assets |
| `DistributionDomainName` | CloudFront domain for the frontend |
| `StateMachineArn` | Step Functions state machine ARN |
| `AdapterRegistryTableName` | DynamoDB adapter registry table |
| `AnalysisStatusTableName` | DynamoDB analysis status table |

---

## Dependencies

- `aws-cdk-lib` ^2.150.0 — AWS CDK constructs
- `constructs` ^10.3.0 — CDK construct base
- `@blast-radius/core` — Shared type definitions

## Scripts

```bash
npm run build   # TypeScript compilation
npm run clean   # Remove dist/
```
