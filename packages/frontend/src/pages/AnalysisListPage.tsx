import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { AnalysisStatus } from '../api/types';

export function AnalysisListPage() {
  const [analyses, setAnalyses] = useState<AnalysisStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .listAnalyses()
      .then(setAnalyses)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading analyses...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div className="analysis-list-page">
      <h1>Analyses</h1>
      {analyses.length === 0 ? (
        <p>
          No analyses found. <Link to="/submit">Submit a new analysis</Link>.
        </p>
      ) : (
        <table className="analysis-table">
          <thead>
            <tr>
              <th>Analysis ID</th>
              <th>Status</th>
              <th>Stage</th>
              <th>Progress</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {analyses.map((analysis) => (
              <tr key={analysis.analysisId}>
                <td>
                  <Link to={`/analyses/${analysis.analysisId}`}>
                    {analysis.analysisId}
                  </Link>
                </td>
                <td className={`status-${analysis.status}`}>
                  {analysis.status}
                </td>
                <td>{analysis.currentStage}</td>
                <td>{analysis.progressPercentage}%</td>
                <td>{new Date(analysis.startedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
