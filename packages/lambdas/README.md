# @blast-radius/lambdas

Lambda function handlers for the Blast Radius analysis pipeline. Each handler is a discrete stage in the Step Functions state machine, designed for independent deployment and testability via dependency injection.

## Handler Reference

| Handler | Purpose | AWS Services | Memory | Timeout |
|---------|---------|-------------|--------|---------|
| ingestion | Validate manifest, flatten hierarchy, generate analysis ID | — | 256 MB | 30s |
| adapter-registry | Route changesets to format-specific adapters | DynamoDB, Lambda | 256 MB | 30s |
| adapters/cloudformation | Convert CloudFormation changesets to canonical format | — | 256 MB | 30s |
| adapters/terraform | Convert Terraform plan JSON to canonical format | — | 256 MB | 30s |
| adapters/cdk | Convert CDK cloud assembly diffs to canonical format | — | 256 MB | 30s |
| resource-resolver | Discover resource dependencies recursively | AWS Config, Resource Explorer | 1024 MB | 90s |
| risk-assessor | Compute impact scores and classify risk | — | 512 MB | 30s |
| visualization-prep | Transform graph for frontend rendering, store in S3 | S3 | 512 MB | 30s |
| risk-summary | Generate natural language summary via Bedrock | Bedrock, S3 | 256 MB | 15s |
| status | Get/update analysis status in DynamoDB | DynamoDB | 256 MB | 10s |
| pipeline/failure-handler | Store partial results on pipeline failure | S3, DynamoDB | 256 MB | 30s |
| results | Authorization-aware result retrieval | DynamoDB, S3 | 256 MB | 30s |

---

## Handlers

### ingestion

Orchestrates manifest validation, hierarchy flattening, and analysis ID generation.

**Input:**
```typescript
interface IngestionInput {
  manifest: unknown;
  requestingPrincipal: string;
  sourceFormat: string;
}
```

**Output:**
```typescript
interface IngestionOutput {
  analysisId: string;           // UUID v4
  validatedManifest: ResourceChangeManifest;
  resourceCount: number;
}
```

**Error codes:** 400 (validation failure), 413 (payload too large — >200 resources or >10MB)

**Flow:**
1. Validate manifest against canonical schema (Zod)
2. Flatten hierarchical groups into a single resource list
3. Generate UUID analysis ID
4. Return flattened manifest with resource count

---

### adapter-registry

Routes incoming changesets to the appropriate Manifest Adapter Lambda based on the declared format. Adapters are registered in a DynamoDB configuration table.

**Input:**
```typescript
interface AdapterRegistryInput {
  format: string;    // e.g. "cloudformation", "terraform", "cdk"
  payload: unknown;  // native changeset data
}
```

**Output:**
```typescript
interface AdapterRegistryOutput {
  manifest: ResourceChangeManifest;
  adapterMetadata: {
    adapterName: string;
    conversionDurationMs: number;
    warnings: string[];
  };
}
```

**Flow:**
1. Look up adapter Lambda ARN in DynamoDB by `formatId`
2. If not found, return error with list of all supported formats
3. Invoke the adapter Lambda with the payload
4. Return the converted manifest with metadata

---

### adapters/cloudformation

Converts AWS CloudFormation changeset JSON into the canonical `ResourceChangeManifest` format.

**Conversion rules:**
- `Action` → `modificationType`: Add, Modify, Remove
- `Replacement: True` → `modificationType: Replace`
- `ResourceType` → `resourceType` (e.g. `AWS::Lambda::Function`)
- `LogicalResourceId` → `resourceId`
- `Scope` and `Details` → `properties.before/after`

---

### adapters/terraform

Converts Terraform plan JSON (`terraform show -json`) into the canonical format.

**Conversion rules:**
- `resource_changes[].change.actions` → `modificationType`
  - `["create"]` → Add
  - `["update"]` → Modify
  - `["delete"]` → Remove
  - `["delete", "create"]` → Replace
- `resource_changes[].type` → `resourceType` (e.g. `aws_lambda_function`)
- `resource_changes[].address` → `resourceId`
- `change.before/after` → `properties.before/after`

---

### adapters/cdk

Converts CDK cloud assembly diff output into the canonical format.

**Conversion rules:**
- Maps CDK diff operations to modification types
- Extracts CloudFormation-style resource types from the underlying template
- Preserves logical IDs as resource identifiers

---

### resource-resolver

Discovers resource dependencies by querying AWS Config relationship data and Resource Explorer. Traverses the dependency graph recursively with circular reference detection.

**Input:**
```typescript
interface ResolverInput {
  resources: ResourceChange[];
  maxDepth: number;                  // default: 5
  requestingPrincipal: string;
  authorizedAccounts?: string[];
  authorizedRegions?: string[];
}
```

**Output:**
```typescript
interface ResolverOutput {
  dependencyGraph: DependencyGraph;
  coverage: {
    fullCoverage: number;
    partialCoverage: number;
    unknownCoverage: number;
  };
  cacheStats: { hits: number; misses: number };
}
```

**Key behaviors:**
- **LRU Cache:** 10,000-entry cache for AWS Config/Resource Explorer responses
- **Circular detection:** Visited-set prevents infinite loops
- **Coverage levels:** `full` (both sources responded), `partial` (one source failed), `unknown` (both failed)
- **Authorization scoping:** Only queries authorized accounts/regions
- **Retry:** Exponential backoff (3 retries, 1s base, 2× multiplier) for throttling/transient errors
- **Depth limit:** Configurable max traversal depth (default 5)

---

### risk-assessor

Computes Impact_Score for each affected resource and classifies into risk categories.

**Scoring Formula:**
```
Impact_Score = round((depthScore × 0.30) + (criticalityScore × 0.40) + (changeTypeSeverity × 0.30))
```

**Component scores:**

| Component | Calculation |
|-----------|-------------|
| depthScore | `max(10, 100 - ((depth - 1) × 10))` — depth 1 = 100, depth 10+ = 10 |
| criticalityScore | Critical=100, High=75, Medium=50, Low=25 |
| changeTypeSeverity | Remove=100, Replace=80, Modify=50, Add=30 |

**Risk classification:**

| Score Range | Category |
|-------------|----------|
| 75–100 | Critical |
| 50–74 | High |
| 25–49 | Medium |
| 0–24 | Low |

**Multi-path handling:** When multiple paths exist from direct changes to an affected resource, the path producing the highest impact score is used.

**Input:**
```typescript
interface AssessorInput {
  dependencyGraph: DependencyGraph;
  manifest: ResourceChangeManifest;
}
```

**Output:**
```typescript
interface AssessorOutput {
  scoredResources: ScoredResource[];
  riskSummary: RiskSummary;
}
```

---

### visualization-prep

Transforms the scored dependency graph into a format optimized for frontend rendering with layout hints.

**Input:**
```typescript
interface VisualizationPrepInput {
  analysisId: string;
  dependencyGraph: DependencyGraph;
  scoredResources: ScoredResource[];
  riskSummary: RiskSummary;
}
```

**Output:** Stores `VisualizationResult` JSON in S3 at `analyses/{analysisId}/visualization.json`

**Layout hints:**
- Node size: 20–60px radius based on impact score
- Node color: Blue (direct changes), Red/Orange/Yellow/Green (risk category)
- Edge thickness: 1–6px based on depth
- Layout algorithm: `hierarchical` for DAGs, `force-directed` for cyclic graphs
- Grouping: Nodes clustered by account/region

---

### risk-summary

Generates a natural language summary of the blast radius analysis using Amazon Bedrock (Claude 3 Haiku).

**Behavior:**
- Selects top 3 highest-scoring resources for the prompt
- 500-word maximum output (truncated at sentence boundary)
- 15-second timeout with graceful degradation (returns without summary on failure)
- Feature flag controlled via `ENABLE_BEDROCK_SUMMARY` environment variable
- Returns immediately when disabled — does not block the pipeline

---

### status

Manages analysis status tracking in DynamoDB. Supports two operations:

- **update** — Called by the pipeline to store/update progress (stage, percentage, elapsed time)
- **get** — Called by the API to retrieve current status (consistent read, <2s response)

Tags all records with `requestingPrincipal` and `originatingAccountId` for authorization.

---

### pipeline/failure-handler

Invoked by Step Functions when a pipeline stage fails.

**Behavior:**
1. Classifies the error into a category (VALIDATION_ERROR, PERMISSION_DENIED, RESOURCE_NOT_FOUND, SERVICE_THROTTLING, TRANSIENT_NETWORK, INTERNAL_ERROR, TIMEOUT, UNKNOWN)
2. Stores partial results in S3 at `results/{analysisId}/analysis-result.json`
3. Updates DynamoDB status to "failed" with error details

**Non-retryable errors:** VALIDATION_ERROR, PERMISSION_DENIED, RESOURCE_NOT_FOUND

---

### results

Authorization-aware result retrieval. Returns only results the requesting principal is authorized to access.

**Authorization logic:**
- Owner (same principal ARN) → full access to all resources
- Account-authorized (principal has access to the originating account) → scoped access (unauthorized resources filtered out with exclusion summary)
- Neither → 403 Forbidden

**Operations:**
- **get** — Retrieve a single analysis result by ID
- **list** — List all accessible results (queries by principal GSI + authorized accounts)

---

## Dependency Injection Pattern

All handlers accept an optional `deps` parameter for testing:

```typescript
// Production usage (deps created internally)
const result = await handler(event);

// Test usage (inject mocks)
const result = await handler(event, {
  s3Client: mockS3Client,
  docClient: mockDynamoClient,
});
```

This pattern eliminates the need for module mocking and makes tests deterministic.

---

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `ADAPTER_REGISTRY_TABLE` | adapter-registry, analyze, formats | DynamoDB table for adapter configuration |
| `STATUS_TABLE` | status, failure-handler, results | DynamoDB table for analysis status |
| `RESULTS_BUCKET` | visualization-prep, risk-summary, failure-handler, results | S3 bucket for analysis results |
| `ENABLE_BEDROCK_SUMMARY` | risk-summary | Feature flag for Bedrock summary generation (`true`/`1`) |
| `BEDROCK_MODEL_ID` | risk-summary | Bedrock model ID (default: `anthropic.claude-haiku-4-5-20251001-v1:0`) |
| `STATE_MACHINE_ARN` | analyze | Step Functions state machine ARN |

---

## Dependencies

- `@blast-radius/core` — Shared types and utilities
- `@aws-sdk/client-dynamodb` / `@aws-sdk/lib-dynamodb` — DynamoDB operations
- `@aws-sdk/client-s3` — S3 storage
- `@aws-sdk/client-lambda` — Lambda invocation (adapter routing)
- `@aws-sdk/client-config-service` — AWS Config queries
- `@aws-sdk/client-resource-explorer-2` — Resource Explorer queries
- `@aws-sdk/client-bedrock-runtime` — Bedrock model invocation

## Scripts

```bash
npm run build   # TypeScript compilation
npm run clean   # Remove dist/
```
