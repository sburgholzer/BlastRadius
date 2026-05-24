← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Scored Resource Model (scored-resource.ts)

The output of the Risk Assessor. After we know the dependency graph, we score each affected resource to answer "how dangerous is this?"

```typescript
interface ScoredResource {
  // Identity (same as DependencyNode)
  resourceId: string;
  resourceType: string;
  provider: string;
  region: string;
  accountId: string;

  // The score and classification
  impactScore: number;              // 0-100, the final risk number
  riskCategory: RiskCategory;       // 'Critical' | 'High' | 'Medium' | 'Low'

  // How we got there
  dependencyChain: string[];        // path from changed resource → this resource
  dependencyDepth: number;          // how many hops away
  criticalityClassification: CriticalityClassification;  // how important this resource type is
  changeTypeSeverity: number;       // how dangerous the change type is
  highestRiskPath: DependencyEdge[];  // the actual edges of the worst-case path
}
```

**The three inputs to the score:**

| Factor | What it measures | Weight | Example |
|--------|-----------------|--------|---------|
| Depth | How far away from the change | 30% | Depth 1 = 100, Depth 5 = 60, Depth 10 = 10 |
| Criticality | How important is this resource type | 40% | Database = 100, Lambda = 75, S3 bucket = 50, Log group = 25 |
| Change type | How dangerous is the action | 30% | Remove = 100, Replace = 80, Modify = 50, Add = 30 |

**The formula:** `impactScore = round((depthScore × 0.30) + (criticalityScore × 0.40) + (changeTypeSeverity × 0.30))`

**Why these weights?** Criticality gets the highest weight (40%) because *what* is affected matters most — deleting a test log group 1 hop away is less scary than modifying something 3 hops from a production database. Depth and change type split the remaining 60% equally because both matter but neither dominates. The weights were chosen to produce intuitive results: a Critical database at depth 1 from a Remove scores 100 (maximum danger), while a Low log group at depth 5 from a Modify scores around 35 (medium, probably fine). The formula is intentionally simple so it's explainable to humans reviewing the output.

**Score → Category mapping:**
- 75-100 → Critical (red in the UI)
- 50-74 → High (orange)
- 25-49 → Medium (yellow)
- 0-24 → Low (green)

**`dependencyChain`** is the breadcrumb trail — the ordered list of resource IDs showing exactly how the risk flows. For example: `["sg-abc123", "ec2-instance-1", "rds-prod"]` means "the security group change affects the EC2 instance, which in turn affects the RDS database."

**`RiskSummary`** is just the totals for the dashboard header:

```typescript
interface RiskSummary {
  critical: number;      // count of Critical resources
  high: number;
  medium: number;
  low: number;
  totalAffected: number; // total downstream resources
  highestScore: number;  // the single scariest score
}
```

This is what shows up as "3 Critical, 5 High, 12 Medium, 8 Low" in the UI.
