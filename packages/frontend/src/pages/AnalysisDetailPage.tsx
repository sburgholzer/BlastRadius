import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { AnalysisResult } from '../api/types';
import { DependencyGraph } from '../components/DependencyGraph';
import { ResourceTable } from '../components/ResourceTable';
import { GraphFilters } from '../components/GraphFilters';
import { ExportPanel } from '../components/ExportPanel';
import type { ScoredResource } from '../api/types';

export function AnalysisDetailPage() {
  const { analysisId } = useParams<{ analysisId: string }>();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filteredResources, setFilteredResources] = useState<ScoredResource[]>([]);
  const [activeView, setActiveView] = useState<'graph' | 'table'>('graph');

  useEffect(() => {
    if (!analysisId) return;

    apiClient
      .getAnalysis(analysisId)
      .then((data) => {
        setResult(data);
        setFilteredResources(data.scoredResources ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [analysisId]);

  if (loading) return <div className="loading">Loading analysis...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!result) return <div className="error">Analysis not found</div>;

  return (
    <div className="analysis-detail-page">
      <h1>Analysis: {result.analysisId}</h1>
      <div className="analysis-meta">
        <span className={`status-${result.status}`}>{result.status}</span>
        <span>Format: {result.sourceFormat}</span>
        {result.completedAt && (
          <span>
            Completed: {new Date(result.completedAt).toLocaleString()}
          </span>
        )}
      </div>

      {result.riskSummary && (
        <div className="risk-summary">
          <h2>Risk Summary</h2>
          <div className="risk-counts">
            <div className="risk-critical">
              Critical: {result.riskSummary.critical}
            </div>
            <div className="risk-high">High: {result.riskSummary.high}</div>
            <div className="risk-medium">
              Medium: {result.riskSummary.medium}
            </div>
            <div className="risk-low">Low: {result.riskSummary.low}</div>
          </div>
          <p>Total affected: {result.riskSummary.totalAffected}</p>
          <p>Highest score: {result.riskSummary.highestScore}</p>
        </div>
      )}

      {result.naturalLanguageSummary && (
        <div className="risk-summary" style={{ marginTop: '1rem' }}>
          <h2>AI Summary</h2>
          <p>{result.naturalLanguageSummary}</p>
        </div>
      )}

      {/* View toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', margin: '1.5rem 0 1rem' }}>
        <button
          onClick={() => setActiveView('graph')}
          style={{
            padding: '0.5rem 1rem',
            background: activeView === 'graph' ? 'var(--color-primary)' : 'var(--color-surface)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.375rem',
            cursor: 'pointer',
          }}
        >
          Graph View
        </button>
        <button
          onClick={() => setActiveView('table')}
          style={{
            padding: '0.5rem 1rem',
            background: activeView === 'table' ? 'var(--color-primary)' : 'var(--color-surface)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.375rem',
            cursor: 'pointer',
          }}
        >
          Table View
        </button>
      </div>

      {/* Filters */}
      {result.scoredResources && result.scoredResources.length > 0 && (
        <GraphFilters
          scoredResources={result.scoredResources}
          sourceFormat={result.sourceFormat ?? 'canonical'}
          onFilterChange={(filtered) => setFilteredResources(filtered)}
        />
      )}

      {/* Graph or Table */}
      {activeView === 'graph' && result.dependencyGraph && result.scoredResources ? (
        <DependencyGraph
          graph={result.dependencyGraph}
          scoredResources={filteredResources}
        />
      ) : (
        <ResourceTable resources={filteredResources} />
      )}

      {/* Export */}
      {result.scoredResources && (
        <ExportPanel
          scoredResources={filteredResources}
          dependencyGraph={result.dependencyGraph}
          analysisId={result.analysisId}
          naturalLanguageSummary={result.naturalLanguageSummary}
        />
      )}
    </div>
  );
}
