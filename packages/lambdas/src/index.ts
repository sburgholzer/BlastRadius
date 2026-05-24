// @blast-radius/lambdas - Lambda function handlers
export { handler as ingestionHandler } from './ingestion/index';
export type { IngestionInput, IngestionOutput, ErrorResponse } from './ingestion/index';

export { handler as adapterRegistryHandler } from './adapter-registry/index';
export type { AdapterRegistryError, AdapterRegistryResult, AdapterRegistryDeps } from './adapter-registry/index';

export { handler as cdkAdapterHandler } from './adapters/cdk/index';
export type { CdkAdapterError, CdkAdapterOutput, CdkAdapterResult } from './adapters/cdk/index';

export { handler as resourceResolverHandler } from './resource-resolver/index';
export type {
  ResolverInput,
  ResolverOutput,
  CoverageReport,
  DiscoveredRelationship,
  ResolverDeps,
} from './resource-resolver/index';

export { handler as cloudFormationAdapterHandler } from './adapters/cloudformation/index';
export type {
  CloudFormationChangeset,
  CloudFormationChange,
  CloudFormationResourceChange,
  CloudFormationAdapterError,
  CloudFormationAdapterOutput,
  CloudFormationAdapterResult,
} from './adapters/cloudformation/index';

export {
  handler as riskAssessorHandler,
  computeDepthScore,
  computeImpactScore,
  classifyRisk,
  computeRiskSummary,
} from './risk-assessor/index';
export type { AssessorInput, AssessorOutput } from './risk-assessor/index';

export { handler as statusHandler } from './status/index';
export type {
  StatusInput,
  UpdateStatusInput,
  GetStatusInput,
  StatusError,
  GetStatusOutput,
  UpdateStatusOutput,
  StatusResult,
  StatusHandlerDeps,
} from './status/index';

export { handler as visualizationPrepHandler } from './visualization-prep/index';
export type {
  VisualizationPrepInput,
  VisualizationPrepOutput,
  VisualizationPrepError,
  VisualizationPrepResult,
  VisualizationPrepDeps,
  VisualizationNode,
  VisualizationEdge,
  VisualizationResult,
  LayoutHints,
  VisualizationGroup,
} from './visualization-prep/index';

export { handler as failureHandler, isNonRetryable } from './pipeline/index';
export type {
  FailureHandlerInput,
  FailureHandlerOutput,
  FailureHandlerError,
  FailureHandlerResult,
  FailureHandlerDeps,
  ErrorCategory,
} from './pipeline/index';

export { handler as resultsHandler } from './results/index';
export type {
  ResultsInput,
  GetResultInput,
  ListResultsInput,
  ResultsError,
  GetResultOutput,
  ListResultsOutput,
  ResultSummaryEntry,
  ResultsResult,
  ResultsHandlerDeps,
} from './results/index';
