import { useEffect, useRef, useState, useCallback } from 'react';
import { apiClient, ApiClientError } from '../api';
import type { AnalysisResult, AnalysisStatus } from '../api/types';
import { ResourceTable } from './ResourceTable';
import { DependencyGraph } from './DependencyGraph';

/** Stage labels for user-friendly display. */
const STAGE_LABELS: Record<string, string> = {
  Ingestion: 'Validating manifest',
  AdapterConversion: 'Converting changeset format',
  Discovery: 'Discovering dependencies',
  Scoring: 'Computing risk scores',
  VisualizationPrep: 'Preparing visualization',
  SummaryGeneration: 'Generating risk summary',
  Complete: 'Analysis complete',
};

/** Default polling interval in milliseconds. */
const DEFAULT_POLL_INTERVAL_MS = 2000;

/** Default timeout for polling in milliseconds (3 minutes). */
const DEFAULT_TIMEOUT_MS = 180000;

export interface AnalysisProgressProps {
  /** The analysis ID to poll status for. */
  analysisId: string;
  /** Polling interval in milliseconds. Defaults to 2000ms. */
  pollIntervalMs?: number;
  /** Timeout for polling in milliseconds. Defaults to 180000ms. */
  timeoutMs?: number;
  /** Callback when analysis completes successfully. */
  onComplete?: (result: AnalysisResult) => void;
  /** Callback when analysis fails. */
  onError?: (error: string) => void;
}

export type ProgressState =
  | { phase: 'polling'; status: AnalysisStatus | null }
  | { phase: 'completed'; result: AnalysisResult }
  | { phase: 'failed'; errorMessage: string; result?: AnalysisResult }
  | { phase: 'timeout'; lastStatus: AnalysisStatus | null };

/**
 * Formats elapsed time in milliseconds to a human-readable string.
 */
export function formatElapsedTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Returns a user-friendly label for a pipeline stage name.
 */
export function getStageLabel(stage: string): string {
  return STAGE_LABELS[stage] || stage;
}

/**
 * Derives a user-friendly error message from an analysis result or error.
 */
export function getErrorMessage(result?: AnalysisResult, error?: unknown): string {
  if (result?.errorDetails) {
    const { stage, errorCategory, message } = result.errorDetails;
    const stageLabel = getStageLabel(stage);
    switch (errorCategory) {
      case 'VALIDATION_ERROR':
        return `Validation failed during "${stageLabel}": ${message}`;
      case 'PERMISSION_DENIED':
        return `Permission denied during "${stageLabel}". Please check your IAM permissions.`;
      case 'RESOURCE_NOT_FOUND':
        return `A required resource was not found during "${stageLabel}": ${message}`;
      case 'SERVICE_THROTTLING':
        return `AWS service rate limit exceeded during "${stageLabel}". The analysis was retried but could not complete.`;
      case 'TIMEOUT':
        return `The analysis timed out during "${stageLabel}". Try reducing the number of resources in your manifest.`;
      default:
        return `Analysis failed during "${stageLabel}": ${message}`;
    }
  }

  if (error instanceof ApiClientError) {
    if (error.statusCode === 408) {
      return 'The analysis timed out. Please try again or reduce the scope of your changeset.';
    }
    if (error.statusCode === 403) {
      return 'Access denied. Please verify your credentials and permissions.';
    }
    return `Request failed: ${error.message}`;
  }

  if (error instanceof Error) {
    return `An unexpected error occurred: ${error.message}`;
  }

  return 'An unexpected error occurred. Please try again.';
}

/**
 * AnalysisProgress component polls the analysis status endpoint during execution,
 * displays progress percentage and current stage, shows user-friendly error messages
 * with a retry option, and falls back to a tabular view if graph rendering fails.
 *
 * Validates: Requirements 5.5, 6.7
 */
export function AnalysisProgress({
  analysisId,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onComplete,
  onError,
}: AnalysisProgressProps) {
  const [state, setState] = useState<ProgressState>({
    phase: 'polling',
    status: null,
  });
  const [graphRenderError, setGraphRenderError] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const mountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollingRef.current !== null) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!mountedRef.current) return;

    // Check timeout
    if (Date.now() - startTimeRef.current > timeoutMs) {
      const currentState = state.phase === 'polling' ? state.status : null;
      setState({ phase: 'timeout', lastStatus: currentState });
      stopPolling();
      onError?.('Analysis polling timed out');
      return;
    }

    try {
      const result = await apiClient.getAnalysis(analysisId);

      if (!mountedRef.current) return;

      if (result.status === 'completed') {
        setState({ phase: 'completed', result });
        stopPolling();
        onComplete?.(result);
      } else if (result.status === 'failed') {
        const errorMessage = getErrorMessage(result);
        setState({ phase: 'failed', errorMessage, result });
        stopPolling();
        onError?.(errorMessage);
      } else {
        // Still running — update status and schedule next poll
        const status: AnalysisStatus = {
          analysisId: result.analysisId,
          requestingPrincipal: result.requestingPrincipal,
          originatingAccountId: result.originatingAccountId,
          status: result.status,
          currentStage: result.completedStages?.length
            ? result.completedStages[result.completedStages.length - 1]
            : 'Ingestion',
          progressPercentage: computeProgress(result),
          elapsedTimeMs: Date.now() - startTimeRef.current,
          startedAt: result.submittedAt,
          updatedAt: new Date().toISOString(),
        };
        setState({ phase: 'polling', status });
        pollingRef.current = setTimeout(poll, pollIntervalMs);
      }
    } catch (err) {
      if (!mountedRef.current) return;

      const errorMessage = getErrorMessage(undefined, err);
      setState({ phase: 'failed', errorMessage });
      stopPolling();
      onError?.(errorMessage);
    }
  }, [analysisId, pollIntervalMs, timeoutMs, onComplete, onError, stopPolling, state]);

  const retry = useCallback(() => {
    startTimeRef.current = Date.now();
    setState({ phase: 'polling', status: null });
    setGraphRenderError(false);
    // Kick off polling again
    poll();
  }, [poll]);

  useEffect(() => {
    mountedRef.current = true;
    startTimeRef.current = Date.now();
    poll();

    return () => {
      mountedRef.current = false;
      stopPolling();
    };
    // Only run on mount and when analysisId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId]);

  // Render based on current state
  if (state.phase === 'polling') {
    return (
      <div className="analysis-progress" role="status" aria-live="polite" aria-label="Analysis progress">
        <div className="progress-header">
          <h2>Analysis in Progress</h2>
          {state.status && (
            <span className="elapsed-time">
              Elapsed: {formatElapsedTime(state.status.elapsedTimeMs)}
            </span>
          )}
        </div>

        {state.status ? (
          <>
            <div className="progress-bar-container">
              <div
                className="progress-bar"
                role="progressbar"
                aria-valuenow={state.status.progressPercentage}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{ width: `${state.status.progressPercentage}%` }}
              />
            </div>
            <div className="progress-details">
              <span className="progress-percentage">
                {state.status.progressPercentage}%
              </span>
              <span className="progress-stage">
                {getStageLabel(state.status.currentStage)}
              </span>
            </div>
          </>
        ) : (
          <div className="progress-loading">
            <span className="spinner" aria-hidden="true" />
            Starting analysis...
          </div>
        )}
      </div>
    );
  }

  if (state.phase === 'timeout') {
    return (
      <div className="analysis-progress analysis-progress--timeout" role="alert">
        <div className="error-container">
          <h2>Analysis Timed Out</h2>
          <p className="error-message">
            The analysis is taking longer than expected. It may still be running in the background.
          </p>
          {state.lastStatus && (
            <p className="error-detail">
              Last known stage: {getStageLabel(state.lastStatus.currentStage)} ({state.lastStatus.progressPercentage}%)
            </p>
          )}
          <button className="retry-button" onClick={retry} type="button">
            Check Again
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === 'failed') {
    return (
      <div className="analysis-progress analysis-progress--failed" role="alert">
        <div className="error-container">
          <h2>Analysis Failed</h2>
          <p className="error-message">{state.errorMessage}</p>
          {state.result?.completedStages && state.result.completedStages.length > 0 && (
            <div className="completed-stages">
              <p>Completed stages:</p>
              <ul>
                {state.result.completedStages.map((stage) => (
                  <li key={stage}>{getStageLabel(stage)}</li>
                ))}
              </ul>
            </div>
          )}
          {state.result?.failedStage && (
            <p className="failed-stage">
              Failed at: {getStageLabel(state.result.failedStage)}
            </p>
          )}
          <button className="retry-button" onClick={retry} type="button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  // phase === 'completed'
  const { result } = state;

  // If graph rendering has failed, fall back to tabular view
  if (graphRenderError) {
    return (
      <div className="analysis-progress analysis-progress--completed">
        <div className="graph-fallback-notice" role="alert">
          <p>Graph visualization could not be rendered. Showing tabular view instead.</p>
          <button
            className="retry-button"
            onClick={() => setGraphRenderError(false)}
            type="button"
          >
            Retry Graph
          </button>
        </div>
        {result.scoredResources && (
          <ResourceTable resources={result.scoredResources} />
        )}
      </div>
    );
  }

  // Render completed results with graph (wrapped in error boundary logic)
  return (
    <div className="analysis-progress analysis-progress--completed">
      {result.dependencyGraph && result.scoredResources ? (
        <GraphWithFallback
          result={result}
          onGraphError={() => setGraphRenderError(true)}
        />
      ) : (
        result.scoredResources && (
          <ResourceTable resources={result.scoredResources} />
        )
      )}
    </div>
  );
}

/**
 * Computes an approximate progress percentage based on completed stages.
 */
function computeProgress(result: AnalysisResult): number {
  const stages = [
    'Ingestion',
    'AdapterConversion',
    'Discovery',
    'Scoring',
    'VisualizationPrep',
    'SummaryGeneration',
  ];
  const completedStages = result.completedStages ?? [];
  if (completedStages.length === 0) return 5; // Just started
  const lastCompleted = completedStages[completedStages.length - 1];
  const stageIndex = stages.indexOf(lastCompleted);
  if (stageIndex === -1) return 50; // Unknown stage, estimate 50%
  // Each stage contributes roughly equal progress
  return Math.min(95, Math.round(((stageIndex + 1) / stages.length) * 100));
}

/**
 * Wrapper component that catches graph rendering errors and triggers fallback.
 */
interface GraphWithFallbackProps {
  result: AnalysisResult;
  onGraphError: () => void;
}

function GraphWithFallback({ result, onGraphError }: GraphWithFallbackProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    // If graph data is malformed or empty, trigger fallback
    if (
      !result.dependencyGraph ||
      !result.dependencyGraph.nodes ||
      result.dependencyGraph.nodes.length === 0
    ) {
      setHasError(true);
      onGraphError();
    }
  }, [result.dependencyGraph, onGraphError]);

  if (hasError) {
    return null;
  }

  try {
    return (
      <DependencyGraph
        graph={result.dependencyGraph!}
        scoredResources={result.scoredResources!}
      />
    );
  } catch {
    // If rendering throws synchronously, trigger fallback
    onGraphError();
    return null;
  }
}
