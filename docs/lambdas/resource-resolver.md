← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Resource Resolver

**`resource-resolver/handler.ts`** — The most complex Lambda. Discovers downstream dependencies for each changed resource by querying AWS Config and Resource Explorer.

**What it does:**
1. For each resource in the changeset, queries AWS Config for relationships
2. Recursively traverses discovered relationships up to `maxDepth` (default: 5)
3. Builds a dependency graph (nodes + edges)
4. Detects circular references via visited-set
5. Classifies coverage: full, partial, or unknown
6. Uses an LRU cache to avoid redundant queries

**Flexible input:** Handles both the original input shape and the pipeline state shape:
```typescript
const resources = event.resources ?? event.validatedManifest?.resources ?? [];
const maxDepth = event.maxDepth ?? event.options?.maxDepth ?? DEFAULT_MAX_DEPTH;
```

**AWS Config query:**
```sql
SELECT relationships.resourceId, relationships.resourceType, relationships.name, awsRegion, accountId
WHERE resourceId = '<resourceId>'
```

Uses `SelectAggregateResourceConfigCommand` with the aggregator specified by `CONFIG_AGGREGATOR_NAME` env var. Relationships with missing `resourceId` are filtered out at the source (Config sometimes returns incomplete relationship entries).

**Dependencies:**
```typescript
interface ResolverDeps {
  configClient: ConfigServiceClient;
  resourceExplorerClient: ResourceExplorer2Client;
  configAggregatorName: string;
}
```

Uses the standard deps pattern with `deps && 'configClient' in deps ? deps : createDefaultDeps()`. In production, creates its own SDK clients. The `configAggregatorName` comes from `process.env.CONFIG_AGGREGATOR_NAME`.

**Output (stored at `$.discoveryResult` in pipeline):**
```typescript
interface ResolverOutput {
  dependencyGraph: { nodes: DependencyNode[]; edges: DependencyEdge[] };
  coverage: { fullCoverage: number; partialCoverage: number; unknownCoverage: number };
  cacheStats: { hits: number; misses: number };
}
```

**Node structure:**
```typescript
interface DependencyNode {
  resourceId: string;
  resourceType: string;
  provider: string;
  region: string;
  accountId: string;
  isDirectChange: boolean;
  dependencyCoverage: 'full' | 'partial' | 'unknown';
}
```

**Edge structure:**
```typescript
interface DependencyEdge {
  sourceId: string;
  targetId: string;
  relationshipType: string;  // e.g., "Is associated with NetworkInterface"
  depth: number;
}
```

**Coverage classification:**
- **Full** — Config returned relationship data for this resource
- **Partial** — Resource Explorer found the resource but Config had limited data
- **Unknown** — Resource couldn't be found in either service

**Performance characteristics:**
- Memory: 1024 MB (Config queries can return large result sets)
- Timeout: 90 seconds
- LRU cache: 10,000 entries (prevents re-querying the same resource in a deep graph)
- Retry: 3 attempts with exponential backoff for retryable errors

**IAM permissions:**
- `config:SelectAggregateResourceConfig`, `config:SelectResourceConfig`, `config:GetResourceConfigHistory`, `config:ListDiscoveredResources`
- `resource-explorer-2:Search`

**Pipeline position:** After Ingestion, before Scoring. The pipeline passes the entire state to Discovery (it reads `validatedManifest.resources` from the state).
