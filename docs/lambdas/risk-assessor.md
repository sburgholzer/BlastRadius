← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Risk Assessor Handler

**`risk-assessor/handler.ts`** — Takes the dependency graph and scores every affected resource. Pure math — no AWS calls, no network, just computation.

**What it does:**
1. Identifies which nodes are "directly changed" (from the manifest) vs "affected downstream"
2. For each affected node, finds all paths from any direct change to that node
3. Scores each path using the formula
4. If multiple paths exist, picks the highest score (worst case)
5. Classifies into risk category
6. Produces a summary (counts per category)

**Multi-path handling — why it matters:**

```
Change A (Remove) → depth 1 → Resource C    → score: 85
Change B (Modify) → depth 3 → Resource C    → score: 52
```

Resource C gets scored 85 (the maximum), not 52 or an average. If *any* path puts it at high risk, it's at high risk. The worst case is what matters for safety.

**Path-finding:** BFS (breadth-first search) from every direct change node. Computationally the most expensive part, but bounded by the depth limit (usually ≤5 levels) so it stays fast.

**What it skips:** Directly changed resources are NOT scored. They're the *source* of risk, not the *target*. You already know you're changing them — the value is showing what *else* might break.

**Output example:**
```typescript
{
  scoredResources: [
    { resourceId: "rds-prod", impactScore: 92, riskCategory: "Critical",
      dependencyChain: ["sg-abc", "ec2-1", "rds-prod"] },
    { resourceId: "ec2-1", impactScore: 68, riskCategory: "High",
      dependencyChain: ["sg-abc", "ec2-1"] },
  ],
  riskSummary: { critical: 1, high: 1, medium: 0, low: 0, totalAffected: 2, highestScore: 92 }
}
```

**Why 512MB/30s:** BFS path-finding can be memory-intensive for dense graphs, but no network calls means most analyses score in under 1 second.
