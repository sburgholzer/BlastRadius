# @blast-radius/frontend

React single-page application for visualizing blast radius analysis results. Features an interactive dependency graph powered by Cytoscape.js, real-time analysis progress tracking, and export capabilities.

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 18.3 | UI framework |
| TypeScript | — | Type safety |
| Vite | 5.4 | Build tool and dev server |
| Cytoscape.js | 3.30 | Interactive graph visualization |
| react-router-dom | 6.23 | Client-side routing |

---

## Pages

### AnalysisListPage (`/analyses`)

Displays all analyses accessible to the current user. Shows status, source format, submission time, and risk summary for each entry.

### AnalysisDetailPage (`/analyses/:analysisId`)

Full analysis view with:
- Interactive dependency graph visualization
- Sortable/filterable resource table
- Risk summary statistics
- Export panel (JSON/PDF)
- Progress tracking for in-progress analyses

### SubmitAnalysisPage (`/submit`)

Form for submitting new analysis requests. Accepts manifest JSON input and format selection.

---

## Components

### DependencyGraph

Interactive graph visualization using Cytoscape.js.

**Features:**
- Pan, zoom, and drag interactions
- Node coloring by risk category (Critical=red, High=orange, Medium=yellow, Low=green, Direct=blue)
- Node sizing by impact score (20–60px radius)
- Edge thickness by dependency depth
- Layout selection: hierarchical (DAGs) or force-directed (cyclic graphs)
- Click-to-select with detail panel
- Account/region grouping

### ResourceTable

Sortable, paginated table of scored resources.

**Features:**
- 50 resources per page
- Sortable columns: resource ID, type, impact score, risk category, depth
- Click row to highlight in graph
- Risk category color indicators

### GraphFilters

Filter controls for the dependency graph visualization.

**Filter dimensions:**
- Risk category (Critical, High, Medium, Low)
- Resource type (multi-select)
- IaC tool/provider (CloudFormation, Terraform, CDK)

### ExportPanel

Export analysis results in multiple formats.

**Formats:**
- JSON — Full structured analysis result
- PDF — Formatted report with graph snapshot

### AnalysisProgress

Real-time progress tracking for in-progress analyses.

**Features:**
- Polling-based status updates (2-second interval)
- Visual progress bar with percentage
- Current stage display
- Error state handling with message display
- Automatic transition to results view on completion
- Graph fallback display for partial results during processing

---

## API Client

Fetch-based HTTP client for communicating with the backend API.

```typescript
import { apiClient } from './api/client';

// Submit a new analysis
const response = await apiClient.submitAnalysis({ format: 'canonical', manifest: data });

// Get analysis by ID
const result = await apiClient.getAnalysis('analysis-id');

// List all analyses
const analyses = await apiClient.listAnalyses();

// Export results
const blob = await apiClient.exportAnalysis('analysis-id', 'json');

// Poll until completion (2s interval, 180s timeout)
const finalResult = await apiClient.pollAnalysis('analysis-id');
```

**Error handling:** Throws `ApiClientError` with `statusCode` and optional `apiError` payload for non-2xx responses.

---

## Routing Structure

```
/                          → Redirects to /analyses
/analyses                  → AnalysisListPage
/analyses/:analysisId      → AnalysisDetailPage
/submit                    → SubmitAnalysisPage
```

All routes are wrapped in a shared `Layout` component providing navigation and page structure.

---

## Development

### Commands

```bash
npm run dev       # Start Vite dev server with HMR
npm run build     # TypeScript check + Vite production build
npm run preview   # Preview production build locally
npm run lint      # ESLint on src/**/*.{ts,tsx}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_BASE_URL` | Backend API base URL | `/api` |

Create a `.env.local` file for local development:

```env
VITE_API_BASE_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com/v1
```

---

## Accessibility

The frontend implements accessibility features throughout:

- **ARIA labels** on interactive elements (graph nodes, filter controls, table headers)
- **ARIA roles** for semantic structure (navigation, main content, complementary panels)
- **Keyboard navigation** for graph interactions, table sorting, and filter controls
- **Focus management** during page transitions and modal interactions
- **Color contrast** meeting WCAG AA standards for risk category indicators
- **Screen reader announcements** for progress updates and status changes

---

## Build Output

Production build outputs to `dist/`:
- `index.html` — Entry point with SPA routing support
- `assets/` — Hashed JS and CSS bundles

The build is deployed to an S3 bucket and served via CloudFront with SPA routing (403/404 → index.html).

---

## Dependencies

- `@blast-radius/core` — Shared type definitions
- `react` / `react-dom` — UI framework
- `react-router-dom` — Client-side routing
- `cytoscape` — Graph visualization engine
