import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { AnalysisResult } from '../api/types';
import { DependencyGraph } from '../components/DependencyGraph';
import { ResourceTable } from '../components/ResourceTable';
import { GraphFilters } from '../components/GraphFilters';
import { ExportPanel } from '../components/ExportPanel';
import DOMPurify from 'dompurify';
import type { ScoredResource, RiskCategory } from '../api/types';

/**
 * Simple markdown to HTML renderer for AI summaries.
 * Handles headings, bold, lists, horizontal rules, and paragraphs.
 */
function renderMarkdown(md: string): string {
  const html = md
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="margin-top:1.25rem;margin-bottom:0.5rem;font-size:1rem;">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 style="margin-top:1.5rem;margin-bottom:0.5rem;font-size:1.125rem;">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--color-border, #334155);margin:1rem 0;">')
    .replace(/^\d+\.\s+(.+)$/gm, '<li style="margin-left:1.5rem;list-style:decimal;">$1</li>')
    .replace(/^[-*]\s+(.+)$/gm, '<li style="margin-left:1.5rem;list-style:disc;">$1</li>')
    .replace(/\n{2,}/g, '</p><p style="margin:0.75rem 0;">')
    .replace(/\n/g, '<br>');
  return DOMPurify.sanitize(`<p style="margin:0.75rem 0;">${html}</p>`);
}

/** Risk card configuration for the summary section. */
const RISK_CARD_CONFIG: { key: keyof Pick<NonNullable<AnalysisResult['riskSummary']>, 'critical' | 'high' | 'medium' | 'low'>; label: string; category: RiskCategory; color: string }[] = [
  { key: 'critical', label: 'Critical', category: 'Critical', color: '#dc2626' },
  { key: 'high', label: 'High', category: 'High', color: '#ea580c' },
  { key: 'medium', label: 'Medium', category: 'Medium', color: '#ca8a04' },
  { key: 'low', label: 'Low', category: 'Low', color: '#16a34a' },
];

export function AnalysisDetailPage() {
  const { analysisId } = useParams<{ analysisId: string }>();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filteredResources, setFilteredResources] = useState<ScoredResource[]>([]);
  const [activeView, setActiveView] = useState<'graph' | 'table'>('graph');
  const [activeRiskFilters, setActiveRiskFilters] = useState<Set<RiskCategory>>(new Set());

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

  /** Toggle a risk category filter from the summary cards. */
  const handleCardClick = useCallback((category: RiskCategory) => {
    setActiveRiskFilters((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }

      // Apply the filter to scored resources
      if (result?.scoredResources) {
        if (next.size === 0) {
          setFilteredResources(result.scoredResources);
        } else {
          setFilteredResources(
            result.scoredResources.filter((r) => next.has(r.riskCategory))
          );
        }
      }

      return next;
    });
  }, [result]);

  if (loading) return <div className="loading">Loading analysis...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!result) return <div className="error">Analysis not found</div>;

  const cardContainerStyle: React.CSSProperties = {
    display: 'flex',
    gap: '0.75rem',
    marginBottom: '1rem',
    flexWrap: 'wrap',
  };

  const cardStyle = (color: string, isActive: boolean): React.CSSProperties => ({
    flex: '1 1 0',
    minWidth: '120px',
    background: isActive ? `${color}15` : 'var(--color-surface, #1e293b)',
    borderLeft: `4px solid ${color}`,
    border: isActive ? `1px solid ${color}` : '1px solid var(--color-border, #334155)',
    borderLeftWidth: '4px',
    borderLeftColor: color,
    borderRadius: '0.5rem',
    padding: '1rem 1.25rem',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    userSelect: 'none' as const,
  });

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
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Risk Summary</h2>
          <div style={cardContainerStyle}>
            {RISK_CARD_CONFIG.map(({ key, label, category, color }) => {
              const count = result.riskSummary![key];
              const isActive = activeRiskFilters.has(category);
              return (
                <div
                  key={key}
                  onClick={() => handleCardClick(category)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCardClick(category); }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isActive}
                  aria-label={`Filter by ${label} risk: ${count} resources`}
                  style={cardStyle(color, isActive)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.filter = 'brightness(1.15)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.filter = 'brightness(1)';
                  }}
                >
                  <div style={{ fontSize: '1.75rem', fontWeight: 700, color, lineHeight: 1.2 }}>
                    {count}
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted, #94a3b8)', marginTop: '0.25rem' }}>
                    {label}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8125rem', color: 'var(--color-text-muted, #94a3b8)' }}>
            <span>Total affected: <strong style={{ color: 'var(--color-text, #f1f5f9)' }}>{result.riskSummary.totalAffected}</strong></span>
            <span>Highest score: <strong style={{ color: 'var(--color-text, #f1f5f9)' }}>{result.riskSummary.highestScore}</strong></span>
            {activeRiskFilters.size > 0 && (
              <button
                onClick={() => {
                  setActiveRiskFilters(new Set());
                  setFilteredResources(result.scoredResources ?? []);
                }}
                style={{ background: 'none', border: 'none', color: 'var(--color-primary, #3b82f6)', cursor: 'pointer', fontSize: '0.8125rem' }}
              >
                Clear filter
              </button>
            )}
          </div>
        </div>
      )}

      {result.naturalLanguageSummary && (
        <div className="risk-summary" style={{ marginTop: '0', marginBottom: '2rem' }}>
          <h2>AI Summary</h2>
          <div
            className="markdown-content"
            style={{
              fontSize: '0.875rem',
              lineHeight: '1.7',
              color: 'var(--color-text, #f1f5f9)',
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(result.naturalLanguageSummary) }}
          />
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
