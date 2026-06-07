← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Frontend (packages/frontend)

React SPA that runs in the browser. Talks to the backend API and renders the interactive graph visualization.

**Structure:**
```
src/
├── api/           → HTTP client for talking to the backend
│   ├── client.ts  → fetch-based API calls + polling + runtime config
│   └── types.ts   → TypeScript types matching backend models
├── pages/         → Full-page views (one per route)
│   ├── AnalysisListPage.tsx    → /analyses (sortable columns)
│   ├── AnalysisDetailPage.tsx  → /analyses/:id
│   └── SubmitAnalysisPage.tsx  → /submit
├── components/    → Reusable UI pieces
│   ├── DependencyGraph.tsx     → Cytoscape.js interactive graph
│   ├── ResourceTable.tsx       → Sortable/paginated table
│   ├── GraphFilters.tsx        → Filter controls (incl. Direct Changes toggle)
│   ├── ExportPanel.tsx         → JSON/PDF download
│   ├── AnalysisProgress.tsx    → Polling + progress bar
│   └── Layout.tsx              → Navigation shell
├── styles/        → CSS
├── App.tsx        → Route definitions
└── main.tsx       → Entry point (mounts React)
```

## API URL Resolution

The frontend resolves the backend API URL at runtime using a priority chain:

1. **`/config.json`** runtime config file (deployed by CDK to S3) — primary for production
2. **`VITE_API_BASE_URL`** environment variable (local dev, build-time override)
3. **`/api`** fallback (same-origin, for proxy setups)

The runtime config approach means the frontend doesn't need to be rebuilt when the API URL changes. CDK deploys a `config.json` to the S3 bucket with `{ "apiBaseUrl": "https://xxx.execute-api.region.amazonaws.com/v1/" }`. This works for both IAM-authenticated and unauthenticated API modes.

The API URL is lazy-loaded on the first API call and cached for the session.

## Analysis List Page

The `/analyses` page shows all analyses sorted by date (newest first) by default. Column headers are clickable to sort by Status, Stage, Progress, or Started time. Clicking the same header again reverses direction. Sort indicators (▲/▼) show the active sort.

## Dependency Graph Visualization

**Node styling by type:**
- **Direct changes** — solid blue nodes. These are the resources explicitly modified in the changeset.
- **Cascading dependencies** — colored by risk category (red = Critical, orange = High, yellow = Medium, green = Low).

**Orphan node filtering:** Nodes with zero edges are hidden from the graph unless they are direct changes. This keeps the visualization focused on actual dependency chains rather than isolated resources.

**Dangling edge filtering:** If a node is filtered out, any edges pointing to/from it are also removed to avoid visual artifacts.

**"Direct Changes" filter toggle:** A blue chip in the filter bar (enabled by default) that shows/hides direct change nodes. When disabled, only cascading dependencies are shown.

## AI Summary (Markdown)

When the pipeline generates a natural language summary, the detail page renders it as formatted markdown. The raw markdown from Bedrock is sanitized using DOMPurify before rendering to prevent XSS. If no summary is available (feature disabled, Bedrock failed, or analysis still running), the section gracefully hides.

## API Response Mapping

The API handler returns data in visualization format (nodes/edges). The frontend maps this to its internal format:
- `nodes` → `scoredResources` (extracted from node data)
- `edges` → `dependencyGraph` (parent/child relationships)
- `naturalLanguageSummary` → rendered as markdown

The frontend gracefully handles missing `riskSummary` or `naturalLanguageSummary` fields — shows "N/A" or hides the section rather than crashing.

## The user flow

1. User visits `/submit` → fills in format + JSON → clicks "Analyze"
2. Frontend POSTs to the API → gets back an `analysisId`
3. Redirects to `/analyses/{analysisId}` → shows `AnalysisProgress` component
4. Progress component polls status every 2 seconds → shows progress bar
5. When status = "completed" → renders `DependencyGraph` + `ResourceTable` + AI Summary + `ExportPanel`
6. When status = "failed" → shows error details with retry button
7. User interacts: clicks nodes, applies filters, exports results

## Key components

- **`api/client.ts`** — All backend communication. Uses `fetch()` (browser-native). Has `pollAnalysis()` that keeps calling `getAnalysis()` every 2 seconds until status is no longer "running." Throws `ApiClientError` with status codes. Lazy-loads API URL from `/config.json` on first call.

- **`DependencyGraph.tsx`** — The star of the show. Cytoscape.js renders an interactive node-edge diagram with zoom, pan, drag, and click-to-select. Clicking a node shows a detail panel with resource ID, type, score, risk category, and dependency chain. Direct changes render as solid blue; cascading deps are colored by risk.

- **`ResourceTable.tsx`** — Sortable table alternative to the graph. Sorted by impact score (highest first) by default. Paginated at 50 rows. Sortable by any column.

- **`GraphFilters.tsx`** — Four filter dimensions: risk category, resource type, source tool, and direct changes (blue chip toggle). Filters apply as intersection — a resource must match ALL active filters. Empty filter = show all.

- **`ExportPanel.tsx`** — Download buttons for JSON and PDF. JSON includes all required fields (type, ID, score, category, chain).

- **`AnalysisProgress.tsx`** — Four states: polling (progress bar), completed (results), failed (error + retry button), timeout ("check again" button). If the graph fails to render, automatically falls back to table view.

## Routing (`App.tsx`)

```
/                    → redirects to /analyses
/analyses            → AnalysisListPage
/analyses/:id        → AnalysisDetailPage
/submit              → SubmitAnalysisPage
```

## Deployment

The frontend is built as static assets and deployed to an S3 bucket served via CloudFront:

```bash
cd packages/frontend
npm run build
aws s3 sync dist/ s3://<frontend-bucket>/ --delete
aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
```

CDK handles the `config.json` deployment automatically on `cdk deploy`.
