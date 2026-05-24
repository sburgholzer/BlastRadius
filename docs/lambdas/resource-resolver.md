← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Resource Resolver Handler

**`resource-resolver/handler.ts`** — The heart of the system. This Lambda takes the validated manifest and builds the dependency graph by querying AWS.

**In plain English:** "You're changing security group sg-abc123. Let me ask AWS what depends on that. Oh, two EC2 instances use it. Now let me ask what depends on *those*. Oh, an RDS database references one of them. And so on, until we've mapped the full blast radius."

**The algorithm — recursive graph traversal with safeguards:**

```
For each resource in the manifest:
  1. Already visited this resource? → skip (circular reference)
  2. Deeper than maxDepth? → stop here
  3. In an authorized account/region? → if not, skip
  4. Check the cache — already looked this up?
     - Yes → use cached result (cache hit)
     - No → query AWS Config + Resource Explorer (cache miss), store result
  5. For each discovered dependency:
     - Add it as a node + edge in the graph
     - Recurse into that dependency (go to step 1)
```

**Three safeguards:**

1. **Circular reference detection (visited-set):** Resources can reference each other (A → B → C → A). A `Set` tracks every resource we've processed — if we encounter it again, we skip it. Prevents infinite loops.

2. **Depth limit (default 5):** Without a limit, we'd traverse the entire AWS account. Configurable per analysis.

3. **Authorization scoping:** Only queries resources in accounts/regions the user is allowed to see.

**Two data sources:**

| Source | What it knows | Example |
|--------|--------------|---------|
| AWS Config | Relationships *within* an account | security group → EC2, subnet → VPC |
| Resource Explorer | Resources *across* accounts and regions | cross-account references |

Both are queried for each resource. Results are combined.

**The LRU cache in action:** If resource A and resource B both depend on resource C, we only query AWS for C once. The second time is a cache hit. For large graphs, this saves hundreds of API calls.

**What it returns:**
```typescript
{
  dependencyGraph: { nodes: [...], edges: [...] },
  coverage: { fullCoverage: 45, partialCoverage: 3, unknownCoverage: 1 },
  cacheStats: { hits: 847, misses: 203 }
}
```

**Why it's the most expensive handler:** Makes real AWS API calls — potentially hundreds for a large manifest. Gets 1024MB memory and 90-second timeout (vs 256MB/30s for most others). The cache and depth limit keep it bounded.
