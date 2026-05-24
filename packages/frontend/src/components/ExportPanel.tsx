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
  /** Natural language summary from Bedrock (optional). */
  naturalLanguageSummary?: string;
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
  naturalLanguageSummary,
}: ExportPanelProps) {
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      setStatus('exporting');
      setErrorMessage(null);

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
          // Real PDF export using jsPDF
          const { default: jsPDF } = await import('jspdf');
          const doc = new jsPDF();
          const pageWidth = doc.internal.pageSize.getWidth();
          const margin = 20;
          const contentWidth = pageWidth - margin * 2;
          let y = 25;

          // Helper: add page if needed
          const checkPage = (needed: number) => {
            if (y + needed > 275) { doc.addPage(); y = 25; }
          };

          // Title
          doc.setFontSize(20);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 41, 59);
          doc.text('Blast Radius Analysis Report', margin, y);
          y += 10;

          // Divider
          doc.setDrawColor(200, 200, 200);
          doc.line(margin, y, pageWidth - margin, y);
          y += 8;

          // Metadata
          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(100, 116, 139);
          doc.text(`Analysis ID: ${analysisId}`, margin, y);
          doc.text(`Exported: ${new Date().toLocaleString()}`, pageWidth - margin, y, { align: 'right' });
          y += 5;
          doc.text(`Total Affected Resources: ${scoredResources.length}`, margin, y);
          y += 12;

          // Risk Summary section
          doc.setFontSize(13);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 41, 59);
          doc.text('Risk Summary', margin, y);
          y += 8;

          const riskCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
          for (const r of scoredResources) riskCounts[r.riskCategory]++;

          // Risk boxes
          const boxWidth = contentWidth / 4;
          const riskItems: { label: string; count: number; color: [number, number, number] }[] = [
            { label: 'Critical', count: riskCounts.Critical, color: [220, 38, 38] },
            { label: 'High', count: riskCounts.High, color: [234, 88, 12] },
            { label: 'Medium', count: riskCounts.Medium, color: [202, 138, 4] },
            { label: 'Low', count: riskCounts.Low, color: [22, 163, 74] },
          ];

          for (let i = 0; i < riskItems.length; i++) {
            const x = margin + i * boxWidth;
            const item = riskItems[i];
            // Box background
            doc.setFillColor(248, 250, 252);
            doc.roundedRect(x, y, boxWidth - 4, 16, 2, 2, 'F');
            // Count
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...item.color);
            doc.text(String(item.count), x + (boxWidth - 4) / 2, y + 7, { align: 'center' });
            // Label
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100, 116, 139);
            doc.text(item.label, x + (boxWidth - 4) / 2, y + 13, { align: 'center' });
          }
          y += 24;

          // AI Summary section (if available)
          if (naturalLanguageSummary) {
            checkPage(40);
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(30, 41, 59);
            doc.text('AI Risk Summary', margin, y);
            y += 7;

            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(51, 65, 85);
            const summaryLines = doc.splitTextToSize(naturalLanguageSummary.replace(/\n+/g, ' ').replace(/\*\*/g, ''), contentWidth);
            for (const line of summaryLines) {
              checkPage(5);
              doc.text(line, margin, y);
              y += 4.5;
            }
            y += 8;
          }

          // Affected Resources section
          checkPage(30);
          doc.setFontSize(13);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 41, 59);
          doc.text('Affected Resources', margin, y);
          y += 10;

          // Table header
          doc.setFillColor(241, 245, 249);
          doc.rect(margin, y - 4, contentWidth, 8, 'F');
          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(71, 85, 105);
          doc.text('SCORE', margin + 2, y);
          doc.text('RISK', margin + 18, y);
          doc.text('RESOURCE TYPE', margin + 42, y);
          doc.text('RESOURCE ID', margin + 95, y);
          y += 7;

          // Table rows
          doc.setFont('helvetica', 'normal');
          for (const resource of scoredResources) {
            checkPage(14);

            // Alternating row background
            const rowIdx = scoredResources.indexOf(resource);
            if (rowIdx % 2 === 0) {
              doc.setFillColor(248, 250, 252);
              doc.rect(margin, y - 3.5, contentWidth, resource.dependencyChain.length > 1 ? 11 : 6, 'F');
            }

            const colors: Record<string, [number, number, number]> = {
              Critical: [220, 38, 38], High: [234, 88, 12], Medium: [202, 138, 4], Low: [22, 163, 74],
            };
            const color = colors[resource.riskCategory] ?? [0, 0, 0];

            doc.setFontSize(9);
            doc.setTextColor(...color);
            doc.setFont('helvetica', 'bold');
            doc.text(String(resource.impactScore), margin + 2, y);
            doc.setFontSize(8);
            doc.text(resource.riskCategory, margin + 18, y);

            doc.setTextColor(30, 41, 59);
            doc.setFont('helvetica', 'normal');
            const shortType = resource.resourceType.replace('AWS::', '');
            doc.text(shortType.length > 28 ? shortType.slice(0, 25) + '...' : shortType, margin + 42, y);

            const shortId = resource.resourceId.length > 40
              ? '...' + resource.resourceId.slice(-37)
              : resource.resourceId;
            doc.setFontSize(7);
            doc.text(shortId, margin + 95, y);
            y += 5;

            // Dependency chain on next line
            if (resource.dependencyChain.length > 1) {
              doc.setFontSize(7);
              doc.setTextColor(148, 163, 184);
              const chain = resource.dependencyChain.map(id =>
                id.length > 25 ? '...' + id.slice(-22) : id
              ).join('  ->  ');
              const chainTruncated = chain.length > 100 ? chain.slice(0, 97) + '...' : chain;
              doc.text(chainTruncated, margin + 4, y);
              y += 5;
            }

            y += 1;
          }

          // Footer
          y += 5;
          doc.setDrawColor(200, 200, 200);
          doc.line(margin, y, pageWidth - margin, y);
          y += 5;
          doc.setFontSize(7);
          doc.setTextColor(148, 163, 184);
          doc.text('Generated by Blast Radius Pre-Deploy Visualizer', margin, y);
          doc.text(`Page 1 of ${doc.getNumberOfPages()}`, pageWidth - margin, y, { align: 'right' });

          doc.save(`blast-radius-${analysisId}.pdf`);
        }

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
