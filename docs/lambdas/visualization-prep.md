← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Visualization Prep Handler

**`visualization-prep/handler.ts`** — The bridge between backend analysis and frontend UI. Transforms the raw scored graph into a format optimized for rendering — with colors, sizes, layout hints, and groupings.

**Why not just send the raw graph to the frontend?** The frontend would need to compute colors, sizes, layout algorithms, and groupings on every render. This handler does that work once, stores the result in S3, and the frontend just reads and renders.

**What it adds to each node:**
```typescript
{
  id: "sg-abc123",
  color: "#dc2626",        // red = Critical risk
  size: 52,                // bigger = higher impact score (20-60px range)
  group: "123456789012/us-east-1",  // clustered by account/region
}
```

**Color mapping:**
- Direct changes → blue (#2563eb) — "this is what you're modifying"
- Critical → red, High → orange, Medium → yellow, Low → green, Unscored → gray

**Edge thickness:** Thicker = closer to the change (depth 1 = 6px, depth 10 = 1px). Visually emphasizes the most direct impacts.

**Layout algorithm selection:**
- No cycles in graph → `hierarchical` (tree-like, top to bottom)
- Cycles detected → `force-directed` (physics simulation, nodes push apart)

Detects cycles using DFS and picks the appropriate algorithm automatically.

**Grouping:** Nodes clustered by `accountId/region` so resources from the same account and region appear together. Helps you see cross-account impact at a glance.

**Storage:** Result stored in S3 at `analyses/{analysisId}/visualization.json`. Frontend fetches this file directly.
