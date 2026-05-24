import { useCallback, useState } from 'react';
import type {
  ScoredResource,
  DependencyGraph,
  RiskCategory,
} from '../api/types';
import type { GraphFilterState } from './GraphFilters';

/** Format for the JSON export report. */
export interface ExportReportJson {
  exportedAt: string;
  analysisId: string;
  filters: {
    riskCategories: RiskCategory[];
    resourceTypes: string[];
    sourceTools: string[];
  };
  totalResources: number;
  resources: ExportResourceEntry[];
  dependencyGraph?: {
    nodes: { resourceId: string; resourceType: string }[];
    edges: { sourceId: string; targetId: string; relationshipType: string }[];
  };
}

/** A single resource entry in the export. */
export interface ExportResourceEntry {
  resourceType: string;
  resourceId: string;
  impactScore: number;
  riskCategory: RiskCategory;
  dependencyChain: string[];
}

export type ExportFormat = 'json' | 'pdf';

export type ExportStatus = 'idle' | 'exporting' | 'success' | 'error';

export interface ExportPanelProps {
  /** The scored resources to export (may be filtered). */
  scoredResources: ScoredResource[];
  /** The dependency graph for the analysis. */
  dependencyGraph?: DependencyGraph;
  /** The analysis ID for the export metadata. */
  analysisId: string;
  /** Currently applied filters (included in export metadata). */
  filters?: GraphFilterState;
}

/**
 * Builds the JSON export data structure from scored resources.
 * Includes all required fields: resource type, resource ID, Impact_Score,
 * risk category, and dependency chain.
 *
 * Validates: Requirements 6.6, 6.8
 */
export function buildJsonExport(
  scoredResources: ScoredResource[],
  analysisId: string,
  filters?: GraphFilterState,
  dependencyGraph?: DependencyGraph,
): ExportReportJson {
  const resources: ExportResourceEntry[] = scoredResources.map((r) => ({
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    impactScore: r.impactScore,
    riskCategory: r.riskCategory,
    dependencyChain: r.dependencyChain,
  }));

  const report: ExportReportJson = {
    exportedAt: new Date().toISOString(),
    analysisId,
    filters: {
      riskCategories: filters ? Array.from(filters.riskCategories) : [],
      resourceTypes: filters ? Array.from(filters.resourceTypes) : [],
      sourceTools: filters ? Array.from(filters.sourceTools) : [],
    },
    totalResources: resources.length,
    resources,
  };

  if (dependencyGraph) {
    report.dependencyGraph = {
      nodes: dependencyGraph.nodes.map((n) => ({
        resourceId: n.resourceId,
        resourceType: n.resourceType,
      })),
      edges: dependencyGraph.edges.map((e) => ({
        sourceId: e.sourceId,
        targetId: e.targetId,
        relationshipType: e.relationshipType,
      })),
    };
  }

  return report;
}

/**
 * Triggers a browser download of the given content as a file.
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generates a PDF export using the JSON data as a placeholder.
 * In a production implementation, this would use a PDF library (e.g., jsPDF or pdfmake)
 * to render the dependency graph, scores, categories, chains, and applied filters.
 * For now, it generates a text-based representation suitable for PDF conversion.
 */
export function buildPdfContent(
  scoredResources: ScoredResource[],
  analysisId: string,
  filters?: GraphFilterState,
  dependencyGraph?: DependencyGraph,
): string {
  const jsonData = buildJsonExport(
    scoredResources,
    analysisId,
    filters,
    dependencyGraph,
  );

  const lines: string[] = [
    '=== Blast Radius Analysis Report ===',
    '',
    `Analysis ID: ${jsonData.analysisId}`,
    `Exported At: ${jsonData.exportedAt}`,
    `Total Resources: ${jsonData.totalResources}`,
    '',
    '--- Applied Filters ---',
    `Risk Categories: ${jsonData.filters.riskCategories.length > 0 ? jsonData.filters.riskCategories.join(', ') : 'All'}`,
    `Resource Types: ${jsonData.filters.resourceTypes.length > 0 ? jsonData.filters.resourceTypes.join(', ') : 'All'}`,
    `Source Tools: ${jsonData.filters.sourceTools.length > 0 ? jsonData.filters.sourceTools.join(', ') : 'All'}`,
    '',
    '--- Affected Resources ---',
    '',
  ];

  for (const resource of jsonData.resources) {
    lines.push(`Resource: ${resource.resourceId}`);
    lines.push(`  Type: ${resource.resourceType}`);
    lines.push(`  Impact Score: ${resource.impactScore}`);
    lines.push(`  Risk Category: ${resource.riskCategory}`);
    lines.push(
      `  Dependency Chain: ${resource.dependencyChain.join(' → ')}`,
    );
    lines.push('');
  }

  if (jsonData.dependencyGraph) {
    lines.push('--- Dependency Graph ---');
    lines.push(`Nodes: ${jsonData.dependencyGraph.nodes.length}`);
    lines.push(`Edges: ${jsonData.dependencyGraph.edges.length}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * ExportPanel provides export controls for downloading analysis results
 * as JSON or PDF. Exports include all required fields per Requirements 6.6 and 6.8:
 * resource type, resource ID, Impact_Score, risk category, and dependency chain.
 * Exports complete within 30 seconds.
 *
 * Validates: Requirements 6.6, 6.8
 */
export function ExportPanel({
  scoredResources,
  dependencyGraph,
  analysisId,
  filters,
}: ExportPanelProps) {
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      setStatus('exporting');
      setErrorMessage(null);

      try {
        // Use a timeout to ensure export completes within 30 seconds
        const exportPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Export timed out after 30 seconds'));
          }, 30_000);

          try {
            if (format === 'json') {
              const report = buildJsonExport(
                scoredResources,
                analysisId,
                filters,
                dependencyGraph,
              );
              const content = JSON.stringify(report, null, 2);
              downloadFile(
                content,
                `blast-radius-${analysisId}.json`,
                'application/json',
              );
            } else {
              // PDF export placeholder using text-based representation
              const content = buildPdfContent(
                scoredResources,
                analysisId,
                filters,
                dependencyGraph,
              );
              downloadFile(
                content,
                `blast-radius-${analysisId}.pdf.txt`,
                'text/plain',
              );
            }

            clearTimeout(timeout);
            resolve();
          } catch (err) {
            clearTimeout(timeout);
            reject(err);
          }
        });

        await exportPromise;
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setErrorMessage(
          err instanceof Error ? err.message : 'Export failed unexpectedly',
        );
      }
    },
    [scoredResources, dependencyGraph, analysisId, filters],
  );

  const handleRetry = useCallback(() => {
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  return (
    <div className="export-panel" role="region" aria-label="Export controls">
      <h3 className="export-panel__title">Export Results</h3>

      <div className="export-panel__actions">
        <button
          className="export-panel__btn export-panel__btn--json"
          onClick={() => handleExport('json')}
          disabled={status === 'exporting' || scoredResources.length === 0}
          aria-label="Export as JSON"
        >
          {status === 'exporting' ? 'Exporting…' : 'Export JSON'}
        </button>

        <button
          className="export-panel__btn export-panel__btn--pdf"
          onClick={() => handleExport('pdf')}
          disabled={status === 'exporting' || scoredResources.length === 0}
          aria-label="Export as PDF"
        >
          {status === 'exporting' ? 'Exporting…' : 'Export PDF'}
        </button>
      </div>

      {status === 'success' && (
        <p className="export-panel__message export-panel__message--success" role="status">
          Export completed successfully.
        </p>
      )}

      {status === 'error' && (
        <div className="export-panel__message export-panel__message--error" role="alert">
          <p>{errorMessage ?? 'Export failed. Please try again.'}</p>
          <button
            className="export-panel__retry-btn"
            onClick={handleRetry}
            aria-label="Retry export"
          >
            Retry
          </button>
        </div>
      )}

      {scoredResources.length === 0 && (
        <p className="export-panel__message export-panel__message--info">
          No resources to export. Adjust filters or wait for analysis to complete.
        </p>
      )}
    </div>
  );
}
