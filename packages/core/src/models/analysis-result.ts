/**
 * Analysis result and status data models.
 *
 * AnalysisResult is the complete output stored in S3 after pipeline completion.
 * AnalysisStatus is the DynamoDB record used for progress tracking and polling.
 */

import type { DependencyGraph } from './dependency-graph';
import type { ResourceChangeManifest } from './manifest';
import type { RiskSummary, ScoredResource } from './scored-resource';

/** The status of an analysis run. */
export type AnalysisRunStatus = 'running' | 'completed' | 'failed';

/** Error details recorded when a pipeline stage fails. */
export interface AnalysisErrorDetails {
  stage: string;
  errorCategory: string;
  message: string;
}

/** Complete analysis result stored in S3 after pipeline execution. */
export interface AnalysisResult {
  analysisId: string;
  status: AnalysisRunStatus;
  requestingPrincipal: string;
  originatingAccountId: string;
  sourceFormat: string;
  submittedAt: string;
  completedAt?: string;
  manifest: ResourceChangeManifest;
  dependencyGraph: DependencyGraph;
  scoredResources: ScoredResource[];
  riskSummary: RiskSummary;
  naturalLanguageSummary?: string;
  stageDurations: Record<string, number>;
  completedStages: string[];
  failedStage?: string;
  errorDetails?: AnalysisErrorDetails;
}

/** Analysis status record stored in DynamoDB for progress polling. */
export interface AnalysisStatus {
  analysisId: string;
  requestingPrincipal: string;
  originatingAccountId: string;
  status: AnalysisRunStatus;
  currentStage: string;
  progressPercentage: number;
  elapsedTimeMs: number;
  startedAt: string;
  updatedAt: string;
  resultLocation?: string;
}
