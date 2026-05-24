/**
 * Frontend API types matching the backend AnalysisResult and AnalysisStatus models.
 */

export type RiskCategory = 'Critical' | 'High' | 'Medium' | 'Low';

export interface RiskSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  totalAffected: number;
  highestScore: number;
}

export interface ScoredResource {
  resourceId: string;
  resourceType: string;
  provider: string;
  region: string;
  accountId: string;
  impactScore: number;
  riskCategory: RiskCategory;
  dependencyChain: string[];
  dependencyDepth: number;
  criticalityClassification: RiskCategory;
  changeTypeSeverity: number;
}

export interface DependencyNode {
  resourceId: string;
  resourceType: string;
  provider: string;
  region: string;
  accountId: string;
  isDirectChange: boolean;
  dependencyCoverage: 'full' | 'partial' | 'unknown';
}

export interface DependencyEdge {
  sourceId: string;
  targetId: string;
  relationshipType: string;
  depth: number;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

export interface AnalysisResult {
  analysisId: string;
  status: 'running' | 'completed' | 'failed';
  requestingPrincipal: string;
  originatingAccountId: string;
  sourceFormat: string;
  submittedAt: string;
  completedAt?: string;
  dependencyGraph?: DependencyGraph;
  scoredResources?: ScoredResource[];
  riskSummary?: RiskSummary;
  naturalLanguageSummary?: string;
  stageDurations?: Record<string, number>;
  completedStages?: string[];
  failedStage?: string;
  errorDetails?: {
    stage: string;
    errorCategory: string;
    message: string;
  };
}

export interface AnalysisStatus {
  analysisId: string;
  requestingPrincipal: string;
  originatingAccountId: string;
  status: 'running' | 'completed' | 'failed';
  currentStage: string;
  progressPercentage: number;
  elapsedTimeMs: number;
  startedAt: string;
  updatedAt: string;
  resultLocation?: string;
}

export interface SubmitAnalysisRequest {
  format: 'canonical' | 'cloudformation' | 'terraform-plan' | 'cdk' | 'pulumi';
  manifest: unknown;
  options?: {
    maxDepth?: number;
    riskThreshold?: number;
    enableSummary?: boolean;
  };
}

export interface SubmitAnalysisResponse {
  analysisId: string;
  status: 'running';
}

export interface SupportedFormat {
  formatId: string;
  displayName: string;
}

export interface ApiError {
  message: string;
  code?: string;
  path?: string;
}
