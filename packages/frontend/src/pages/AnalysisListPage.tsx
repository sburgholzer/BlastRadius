import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { AnalysisStatus } from '../api/types';

type SortField = 'startedAt' | 'status' | 'currentStage' | 'progressPercentage';
type SortDirection = 'asc' | 'desc';

export function AnalysisListPage() {
  const [analyses, setAnalyses] = useState<AnalysisStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('startedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    apiClient
      .listAnalyses()
      .then(setAnalyses)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'startedAt' ? 'desc' : 'asc');
    }
  }

  function sortIndicator(field: SortField): string {
    if (sortField !== field) return '';
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  }

  const sorted = [...analyses].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'startedAt':
        cmp = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
        break;
      case 'status':
        cmp = a.status.localeCompare(b.status);
        break;
      case 'currentStage':
        cmp = (a.currentStage || '').localeCompare(b.currentStage || '');
        break;
      case 'progressPercentage':
        cmp = a.progressPercentage - b.progressPercentage;
        break;
    }
    return sortDirection === 'asc' ? cmp : -cmp;
  });

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
              <th className="sortable" onClick={() => handleSort('status')}>
                Status{sortIndicator('status')}
              </th>
              <th className="sortable" onClick={() => handleSort('currentStage')}>
                Stage{sortIndicator('currentStage')}
              </th>
              <th className="sortable" onClick={() => handleSort('progressPercentage')}>
                Progress{sortIndicator('progressPercentage')}
              </th>
              <th className="sortable" onClick={() => handleSort('startedAt')}>
                Started{sortIndicator('startedAt')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((analysis) => (
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
