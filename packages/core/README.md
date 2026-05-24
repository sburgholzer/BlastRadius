# @blast-radius/core

Shared data models, validation, caching, retry utilities, verdict logic, authorization, and configuration for the Blast Radius Pre-Deploy Visualizer.

This package is the foundation of the monorepo — all other packages depend on it for type definitions and shared business logic.

## Installation

```bash
# From the monorepo root
npm install
```

## Module Overview

| Module | Purpose |
|--------|---------|
| `models/` | Canonical data types for the entire pipeline |
| `validation/` | Zod-based manifest validation and hierarchy flattening |
| `cache/` | Generic LRU cache with hit/miss statistics |
| `utils/` | Retry with exponential backoff for AWS SDK calls |
| `config/` | Resource criticality classification mappings |
| `verdict/` | Pass/fail threshold evaluation for CI/CD gates |
| `auth/` | SigV4 identity extraction and access scoping |

---

## models/

Canonical data types shared across all pipeline stages.

### ResourceChangeManifest

The tool-neutral representation of proposed infrastructure modifications.

```typescript
interface ResourceChangeManifest {
  version: string;
  metadata: ManifestMetadata;
  resources: ResourceChange[];
  groups?: ManifestGroup[];
}

interface ManifestMetadata {
  submittedAt: string;
  sourceFormat: string;
  description?: string;
}

interface ResourceChange {
  resourceType: string;
  resourceId: string;
  provider: string;
  modificationType: ModificationType; // 'Add' | 'Modify' | 'Remove' | 'Replace'
  region?: string;
  accountId?: string;
  properties?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
}

interface ManifestGroup {
  name: string;
  resources: ResourceChange[];
  groups?: ManifestGroup[]; // recursive nesting
}
```

### DependencyGraph

Directed graph of resource relationships discovered by the Resource Resolver.

```typescript
interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

interface DependencyNode {
  resourceId: string;
  resourceType: string;
  provider: string;
  region: string;
  accountId: string;
  isDirectChange: boolean;
  dependencyCoverage: 'full' | 'partial' | 'unknown';
}

interface DependencyEdge {
  sourceId: string;
  targetId: string;
  relationshipType: string;
  depth: number;
}
```

### ScoredResource

Impact analysis results for each affected resource.

```typescript
interface ScoredResource {
  resourceId: string;
  resourceType: string;
  provider: string;
  region: string;
  accountId: string;
  impactScore: number;           // 0-100
  riskCategory: RiskCategory;    // 'Critical' | 'High' | 'Medium' | 'Low'
  dependencyChain: string[];
  dependencyDepth: number;
  criticalityClassification: CriticalityClassification;
  changeTypeSeverity: number;
  highestRiskPath: DependencyEdge[];
}

interface RiskSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  totalAffected: number;
  highestScore: number;
}
```

### AnalysisResult & AnalysisStatus

```typescript
interface AnalysisResult {
  analysisId: string;
  status: AnalysisRunStatus;  // 'running' | 'completed' | 'failed'
  requestingPrincipal: string;
  originatingAccountId: string;
  sourceFormat: string;
  submittedAt: string;
  completedAt?: string;
  manifest: ResourceChangeManifest;
  dependencyGraph: DependencyGraph;
  scoredResources: ScoredResource[];
  riskSummary: RiskSummary;
  naturalLanguageSummary?: string;
  stageDurations: Record<string, number>;
  completedStages: string[];
  failedStage?: string;
  errorDetails?: AnalysisErrorDetails;
}

interface AnalysisStatus {
  analysisId: string;
  requestingPrincipal: string;
  originatingAccountId: string;
  status: AnalysisRunStatus;
  currentStage: string;
  progressPercentage: number;
  elapsedTimeMs: number;
  startedAt: string;
  updatedAt: string;
  resultLocation?: string;
}
```

### Adapter Types

```typescript
interface AdapterRegistryEntry {
  formatId: string;
  adapterLambdaArn: string;
  displayName: string;
  version: string;
  registeredAt: string;
}

interface ManifestAdapter {
  convert(nativeChangeset: unknown): ResourceChangeManifest;
  supportedFormat(): string;
}

interface AdapterRegistryInput {
  format: string;
  payload: unknown;
}

interface AdapterRegistryOutput {
  manifest: ResourceChangeManifest;
  adapterMetadata: AdapterMetadata;
}
```

---

## validation/

Zod-based schema validation and hierarchy flattening with enforced limits.

### Limits

| Constraint | Value |
|-----------|-------|
| Max resources | 200 |
| Max payload size | 10 MB |
| Max nesting depth | 10 levels |

### validateManifest

Validates an unknown input against the canonical schema. Returns structured errors with JSON path of the first violation.

```typescript
import { validateManifest } from '@blast-radius/core';

const result = validateManifest(unknownInput);

if (result.success) {
  console.log(result.manifest); // typed ResourceChangeManifest
} else {
  console.error(result.error); // human-readable message
  console.error(result.path);  // e.g. "resources[0].resourceType"
}
```

### flattenHierarchy

Recursively flattens nested groups into a single resource list. Preserves all entries without duplication.

```typescript
import { flattenHierarchy } from '@blast-radius/core';

const result = flattenHierarchy(validatedManifest);

if (result.success) {
  console.log(result.resources); // ResourceChange[]
} else {
  console.error(result.error); // depth limit exceeded
  console.error(result.path);  // e.g. "groups[0].groups[1].groups"
}
```

---

## cache/

### LRUCache\<K, V\>

Generic Least Recently Used cache with O(1) lookups using JavaScript `Map` insertion-order semantics.

| Property | Default |
|----------|---------|
| Capacity | 10,000 entries |
| Eviction | Least recently used (first Map entry) |
| Stats | Hit/miss counters |

```typescript
import { LRUCache } from '@blast-radius/core';

const cache = new LRUCache<string, object>(10_000);

cache.set('key', { data: 'value' });
const value = cache.get('key'); // moves to most-recently-used

const stats = cache.getStats();
// { hits: number, misses: number, size: number, maxSize: number }
```

**API:**
- `get(key: K): V | undefined` — Retrieve and promote to MRU
- `set(key: K, value: V): void` — Insert/update, evict LRU if at capacity
- `has(key: K): boolean` — Check existence (no LRU reorder)
- `delete(key: K): boolean` — Remove entry
- `clear(): void` — Clear all entries and reset stats
- `getStats(): CacheStats` — Get hit/miss/size statistics
- `size: number` — Current entry count

---

## utils/

### withRetry

Executes an async function with exponential backoff. Retries transient/throttling errors; fails immediately on validation or access errors.

```typescript
import { withRetry, isRetryableError, computeBackoffDelay } from '@blast-radius/core';

const result = await withRetry(
  () => awsClient.send(command),
  {
    maxRetries: 3,       // default: 3
    baseDelayMs: 1000,   // default: 1000
    maxDelayMs: 30000,   // default: 30000
    retryableErrors: [], // additional error codes
  }
);

if (result.success) {
  console.log(result.result);
} else {
  console.error(result.error);
}
console.log(`Took ${result.attempts} attempt(s)`);
```

**Backoff formula:** `delay = min(baseDelay × 2^attempt, maxDelay)`

**Retryable errors:** ThrottlingException, TooManyRequestsException, ServiceUnavailableException, InternalServerError, RequestTimeout, NetworkingError, ECONNRESET, ETIMEDOUT

**Non-retryable errors (fail immediately):** ValidationException, AccessDeniedException, ResourceNotFoundException, InvalidParameterValue

---

## config/

### createCriticalityConfig

Creates a configuration object mapping resource types to criticality classifications. Includes defaults for both CloudFormation and Terraform resource type formats.

```typescript
import { createCriticalityConfig } from '@blast-radius/core';

const config = createCriticalityConfig();

config.getCriticality('AWS::RDS::DBInstance');  // 'Critical'
config.getCriticality('aws_lambda_function');   // 'High'
config.getCriticality('AWS::S3::Bucket');       // 'Medium'
config.getCriticality('unknown_type');          // 'Medium' (default)

// Override mappings
config.setOverrides({ 'custom::MyResource': 'Critical' });

// Get all mappings (defaults merged with overrides)
const all = config.getMappings();
```

**Default Criticality Mappings:**

| Classification | CloudFormation Types | Terraform Types |
|---------------|---------------------|-----------------|
| Critical | RDS::DBInstance, DynamoDB::Table, EKS::Cluster, ELBv2::LoadBalancer, Route53::HostedZone | aws_db_instance, aws_rds_cluster, aws_dynamodb_table, aws_eks_cluster, aws_lb, aws_alb, aws_route53_zone |
| High | EC2::Instance, Lambda::Function, ECS::Service, ElastiCache::CacheCluster, ApiGateway::RestApi | aws_instance, aws_lambda_function, aws_ecs_service, aws_elasticache_cluster, aws_api_gateway_rest_api |
| Medium | EC2::SecurityGroup, IAM::Role, S3::Bucket, SNS::Topic, SQS::Queue | aws_security_group, aws_iam_role, aws_s3_bucket, aws_sns_topic, aws_sqs_queue |
| Low | CloudWatch::Alarm, CloudFormation::Tag, Logs::LogGroup, SSM::Parameter | aws_cloudwatch_metric_alarm, aws_cloudwatch_log_group, aws_ssm_parameter |

---

## verdict/

### evaluateThreshold

Evaluates scored resources against a risk threshold to produce a pass/fail verdict for CI/CD gates.

```typescript
import { evaluateThreshold, validateThreshold } from '@blast-radius/core';

// Validate threshold input
const error = validateThreshold(75); // returns null if valid, error string if not

// Evaluate verdict
const verdict = evaluateThreshold(scoredResources, 75);

switch (verdict.verdict) {
  case 'pass':
    // verdict.exitCode === 0
    // verdict.summary.totalAffected, verdict.summary.highestScore
    break;
  case 'fail':
    // verdict.exitCode === 1
    // verdict.exceedingResources[] — resources above threshold
    // verdict.summary.exceedingCount
    break;
  case 'error':
    // verdict.exitCode === 2
    // verdict.message — validation error description
    break;
}
```

**Exit codes:** 0 = pass, 1 = fail, 2 = error

**Threshold:** Integer 0–100. Resources with `impactScore > threshold` cause a fail verdict.

---

## auth/

IAM-based access control and multi-tenancy support.

### extractPrincipalFromSigV4

Extracts the requesting principal's IAM ARN from a SigV4-signed API Gateway event.

```typescript
import { extractPrincipalFromSigV4 } from '@blast-radius/core';

const identity = extractPrincipalFromSigV4(apiGatewayEvent);
// { principalArn: string, accountId: string } | null
```

### scopeDependencyGraph / scopeScoredResources

Filters resources to only those the requesting principal is authorized to access.

```typescript
import { scopeDependencyGraph, scopeScoredResources } from '@blast-radius/core';

const policy: AuthorizationPolicy = {
  authorizedAccounts: ['123456789012'],
  authorizedRegions: ['us-east-1', 'us-west-2'],
};

const { graph, exclusionSummary } = scopeDependencyGraph(fullGraph, policy);
const { resources, exclusionSummary } = scopeScoredResources(allResources, policy);
// exclusionSummary: { excludedAccounts, excludedRegions, omittedResourceCount, reason }
```

### resolveAccessScope

Determines the authorization scope for a principal using a pluggable resolver.

```typescript
import { resolveAccessScope } from '@blast-radius/core';

const policy = await resolveAccessScope(principalArn, {
  resolvePolicy: async (arn) => ({
    authorizedAccounts: ['123456789012'],
    authorizedRegions: [],
  }),
});
```

### createAuthenticationError

Returns a standardized 401 error response without revealing internal details.

```typescript
import { createAuthenticationError } from '@blast-radius/core';

const error = createAuthenticationError();
// { statusCode: 401, error: 'Unauthorized', message: '...' }
```

---

## Dependencies

- `zod` ^3.22.0 — Schema validation

## Scripts

```bash
npm run build   # TypeScript compilation
npm run clean   # Remove dist/
```
