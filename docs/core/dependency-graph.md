← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Dependency Graph Model (dependency-graph.ts)

The dependency graph is what gets built *after* the Resource Resolver queries AWS Config. It answers: "what other resources depend on the things being changed?"

```typescript
interface DependencyGraph {
  nodes: DependencyNode[];  // all resources (changed + affected)
  edges: DependencyEdge[];  // relationships between them
}
```

**Nodes** — every resource in the picture:

```typescript
interface DependencyNode {
  resourceId: string;          // e.g. "sg-abc123"
  resourceType: string;        // e.g. "AWS::EC2::SecurityGroup"
  provider: string;            // "aws"
  region: string;              // "us-east-1"
  accountId: string;           // "123456789012"
  isDirectChange: boolean;     // true = you're changing this, false = it's downstream
  dependencyCoverage: 'full' | 'partial' | 'unknown';
}
```

`isDirectChange` is the key distinction — it separates "things you're modifying" from "things that might break because of your modification."

`dependencyCoverage` tells you how confident the system is about this node's relationships. The Resource Resolver queries two AWS services for each resource: **AWS Config** (relationships within an account) and **Resource Explorer** (relationships across accounts/regions). The coverage level records what happened:

| Scenario | Coverage | Meaning |
|----------|----------|---------|
| Both Config and Resource Explorer responded successfully | `full` | We're confident we found all dependencies |
| One responded but the other failed (throttled, timed out) | `partial` | We found some dependencies but might be missing others |
| Both failed | `unknown` | We have no idea what depends on this resource |

"Full" doesn't mean the resource *has* dependencies — a resource with zero relationships but successful API responses is still `full` (we're confident it's a leaf node). This matters for the UI: nodes marked `partial` or `unknown` signal to the user that the picture might be incomplete.

**Edges** — the connections between resources:

```typescript
interface DependencyEdge {
  sourceId: string;           // the resource that something depends on
  targetId: string;           // the resource that depends on it
  relationshipType: string;   // e.g. "is_attached_to", "references"
  depth: number;              // how many hops from the direct change
}
```

**Real-world example:** you're modifying a security group. The graph might look like:

```
sg-abc123 (direct change, depth 0)
  ├──edge──→ ec2-instance-1 (depth 1, "is_attached_to")
  │              └──edge──→ rds-prod (depth 2, "references")
  └──edge──→ ec2-instance-2 (depth 1, "is_attached_to")
```

The `depth` tells the scoring system how far away something is from the change. Depth 1 = directly connected = higher risk. Depth 5 = far away = lower risk.
