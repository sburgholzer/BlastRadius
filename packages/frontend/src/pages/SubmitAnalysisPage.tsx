import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { SubmitAnalysisRequest } from '../api/types';

const SUPPORTED_FORMATS: Array<{
  value: SubmitAnalysisRequest['format'];
  label: string;
}> = [
  { value: 'canonical', label: 'Canonical Manifest' },
  { value: 'cloudformation', label: 'CloudFormation Changeset' },
  { value: 'terraform-plan', label: 'Terraform Plan JSON' },
  { value: 'cdk', label: 'CDK Cloud Assembly Diff' },
  { value: 'pulumi', label: 'Pulumi Preview' },
];

export function SubmitAnalysisPage() {
  const navigate = useNavigate();
  const [format, setFormat] =
    useState<SubmitAnalysisRequest['format']>('canonical');
  const [manifestJson, setManifestJson] = useState('');
  const [maxDepth, setMaxDepth] = useState(5);
  const [riskThreshold, setRiskThreshold] = useState(75);
  const [enableSummary, setEnableSummary] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const manifest = JSON.parse(manifestJson);
      const response = await apiClient.submitAnalysis({
        format,
        manifest,
        options: { maxDepth, riskThreshold, enableSummary },
      });
      navigate(`/analyses/${response.analysisId}`);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON in manifest field');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="submit-analysis-page">
      <h1>Submit New Analysis</h1>
      <form onSubmit={handleSubmit} className="submit-form">
        <div className="form-group">
          <label htmlFor="format">Format</label>
          <select
            id="format"
            value={format}
            onChange={(e) =>
              setFormat(e.target.value as SubmitAnalysisRequest['format'])
            }
          >
            {SUPPORTED_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="manifest">Manifest / Changeset JSON</label>
          <textarea
            id="manifest"
            value={manifestJson}
            onChange={(e) => setManifestJson(e.target.value)}
            rows={15}
            placeholder="Paste your manifest or changeset JSON here..."
            required
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="maxDepth">Max Depth</label>
            <input
              id="maxDepth"
              type="number"
              min={1}
              max={10}
              value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
            />
          </div>

          <div className="form-group">
            <label htmlFor="riskThreshold">Risk Threshold</label>
            <input
              id="riskThreshold"
              type="number"
              min={0}
              max={100}
              value={riskThreshold}
              onChange={(e) => setRiskThreshold(Number(e.target.value))}
            />
          </div>

          <div className="form-group">
            <label htmlFor="enableSummary">
              <input
                id="enableSummary"
                type="checkbox"
                checked={enableSummary}
                onChange={(e) => setEnableSummary(e.target.checked)}
              />
              Enable AI Summary
            </label>
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}

        <button type="submit" disabled={submitting} className="submit-button">
          {submitting ? 'Submitting...' : 'Analyze'}
        </button>
      </form>
    </div>
  );
}
