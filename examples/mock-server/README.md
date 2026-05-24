# Mock Server

A local Express server that serves pre-built analysis results. No AWS account needed — connect the frontend and immediately see the interactive dependency graph with realistic data.

## Quick Start

```bash
npm install
npm start
```

The server starts on http://localhost:3001.

## Connecting the Frontend

Start the frontend with the API URL pointing to the mock server:

```bash
cd ../../packages/frontend
VITE_API_BASE_URL=http://localhost:3001/api npm run dev
```

Then open http://localhost:5173 and navigate to any analysis.

## Available Scenarios

The server ships with three pre-built scenarios:

| Scenario | File | Description |
|----------|------|-------------|
| Security Group Change | `data/security-group-change.json` | Removing HTTPS ingress from a security group. 5 affected resources, 1 Critical. |
| Database Delete | `data/database-delete.json` | Deleting a production RDS instance. 8 affected resources, 4 Critical. |
| Multi-Resource | `data/multi-resource.json` | VPC restructuring with 5 direct changes. 12 affected resources across 2 accounts. |

## API Endpoints

### GET /api/analyses

Returns a list of all available demo analyses (used by the frontend's list page).

### GET /api/formats

Returns the list of supported input formats.

### POST /api/analyze

Simulates submitting an analysis. Returns immediately with a completed status and an `analysisId`.

### GET /api/analyze/:id

Returns analysis results. Use the `scenario` query parameter to pick a specific scenario:

```
GET /api/analyze/any-id?scenario=security-group-change
GET /api/analyze/any-id?scenario=database-delete
GET /api/analyze/any-id?scenario=multi-resource
```

Without the `scenario` param, the server cycles through scenarios on each request.

### GET /api/scenarios

Lists all available scenarios with their risk summaries.

## Adding Custom Scenarios

Drop a JSON file into the `data/` directory following the same structure as the existing files. The server picks up all `.json` files in that directory on startup.

The JSON structure matches the `AnalysisResult` type from the core package:

```typescript
{
  summary: string;
  directChanges: DirectChange[];
  dependencyGraph: { nodes: DependencyNode[]; edges: DependencyEdge[] };
  scoredResources: ScoredResource[];
  riskSummary: RiskSummary;
  metadata: { analysisId: string; sourceFormat: string; ... };
}
```

See `packages/core/src` for the full type definitions.
