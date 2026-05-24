export {
  extractPrincipalFromSigV4,
  scopeDependencyGraph,
  scopeScoredResources,
  resolveAccessScope,
  createAuthenticationError,
} from './access-scoper';

export type {
  RequestIdentity,
  SigV4RequestContext,
  AuthorizationPolicy,
  ExclusionSummary,
  ScopedGraphResult,
  ScopedResourcesResult,
  AuthorizationResolver,
  AuthenticationError,
} from './access-scoper';
