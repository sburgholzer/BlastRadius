import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { AnalysisResult } from '../api/types';

export function AnalysisDetailPage() {
  const { analysisId } = useParams<{ analysisId: string }>();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!analysisId) return;

    apiClient
      .getAnalysis(analysisId)
      .then(setResult)
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

      {/* Graph visualization and tabular views will be added in subsequent tasks */}
      <div className="analysis-content">
        <p>
          Graph visualization and detailed resource views will be rendered here.
        </p>
      </div>
    </div>
  );
}
