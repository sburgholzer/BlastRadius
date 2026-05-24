← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Frontend (packages/frontend)

React SPA that runs in the browser. Talks to the backend API and renders the interactive graph visualization.

**Structure:**
```
src/
├── api/           → HTTP client for talking to the backend
│   ├── client.ts  → fetch-based API calls + polling
│   └── types.ts   → TypeScript types matching backend models
├── pages/         → Full-page views (one per route)
│   ├── AnalysisListPage.tsx    → /analyses
│   ├── AnalysisDetailPage.tsx  → /analyses/:id
│   └── SubmitAnalysisPage.tsx  → /submit
├── components/    → Reusable UI pieces
│   ├── DependencyGraph.tsx     → Cytoscape.js interactive graph
│   ├── ResourceTable.tsx       → Sortable/paginated table
│   ├── GraphFilters.tsx        → Filter controls
│   ├── ExportPanel.tsx         → JSON/PDF download
│   ├── AnalysisProgress.tsx    → Polling + progress bar
│   └── Layout.tsx              → Navigation shell
├── styles/        → CSS
├── App.tsx        → Route definitions
└── main.tsx       → Entry point (mounts React)
```

**The user flow:**
1. User visits `/submit` → fills in format + JSON → clicks "Analyze"
2. Frontend POSTs to the API → gets back an `analysisId`
3. Redirects to `/analyses/{analysisId}` → shows `AnalysisProgress` component
4. Progress component polls status every 2 seconds → shows progress bar
5. When status = "completed" → renders `DependencyGraph` + `ResourceTable` + `ExportPanel`
6. User interacts: clicks nodes, applies filters, exports results

**Key components:**

- **`api/client.ts`** — All backend communication. Uses `fetch()` (browser-native). Has `pollAnalysis()` that keeps calling `getAnalysis()` every 2 seconds until status is no longer "running." Throws `ApiClientError` with status codes.

- **`DependencyGraph.tsx`** — The star of the show. Cytoscape.js renders an interactive node-edge diagram with zoom, pan, drag, and click-to-select. Clicking a node shows a detail panel with resource ID, type, score, risk category, and dependency chain.

- **`ResourceTable.tsx`** — Sortable table alternative to the graph. Sorted by impact score (highest first) by default. Paginated at 50 rows. Sortable by any column.

- **`GraphFilters.tsx`** — Three filter dimensions: risk category, resource type, source tool. Filters apply as intersection — a resource must match ALL active filters. Empty filter = show all.

- **`ExportPanel.tsx`** — Download buttons for JSON and PDF. JSON includes all required fields (type, ID, score, category, chain).

- **`AnalysisProgress.tsx`** — The most complex component. Four states: polling (progress bar), completed (results), failed (error + retry button), timeout ("check again" button). If the graph fails to render, automatically falls back to table view.

**Routing (`App.tsx`):**
```
/                    → redirects to /analyses
/analyses            → AnalysisListPage
/analyses/:id        → AnalysisDetailPage
/submit              → SubmitAnalysisPage
```

**Environment variable:** `VITE_API_BASE_URL` — where the backend API lives. Defaults to `/api` (for local dev with Vite proxy). In production, set to the API Gateway URL.
