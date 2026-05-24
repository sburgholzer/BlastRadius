// @blast-radius/core - Core data models and shared utilities
export type {
  ManifestMetadata,
  ResourceChange,
  ManifestGroup,
  ResourceChangeManifest,
  ModificationType,
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  DependencyCoverage,
  ScoredResource,
  RiskSummary,
  RiskCategory,
  CriticalityClassification,
  AnalysisResult,
  AnalysisStatus,
  AnalysisRunStatus,
  AnalysisErrorDetails,
  AdapterRegistryEntry,
  ManifestAdapter,
  AdapterRegistryInput,
  AdapterRegistryOutput,
  AdapterMetadata,
} from './models';

export { validateManifest } from './validation/index';
export type { ValidationResult } from './validation/index';

export { flattenHierarchy } from './validation/index';
export type { FlattenResult } from './validation/index';

export type { CriticalityConfig } from './config/index';
export { createCriticalityConfig } from './config/index';

export { LRUCache } from './cache/index';
export type { CacheStats } from './cache/index';

export {
  withRetry,
  isRetryableError,
  computeBackoffDelay,
  RETRYABLE_ERROR_CODES,
  NON_RETRYABLE_ERROR_CODES,
} from './utils/index';
export type { RetryOptions, RetryResult } from './utils/index';

export { evaluateThreshold, validateThreshold } from './verdict/index';
export type {
  VerdictResult,
  PassVerdict,
  FailVerdict,
  ThresholdValidationError,
  ExceedingResource,
} from './verdict/index';

export {
  extractPrincipalFromSigV4,
  scopeDependencyGraph,
  scopeScoredResources,
  resolveAccessScope,
  createAuthenticationError,
} from './auth/index';
export type {
  RequestIdentity,
  SigV4RequestContext,
  AuthorizationPolicy,
  ExclusionSummary,
  ScopedGraphResult,
  ScopedResourcesResult,
  AuthorizationResolver,
  AuthenticationError,
} from './auth/index';
