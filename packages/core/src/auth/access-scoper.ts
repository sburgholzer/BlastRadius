/**
 * Access Scoper for IAM-based access control and multi-tenancy.
 *
 * Extracts the requesting principal's IAM ARN from SigV4 signature context,
 * determines authorized accounts/regions, scopes resource discovery to
 * authorized boundaries, and omits unauthorized resources with an exclusion summary.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
 */

import type { ScoredResource } from '../models/scored-resource';
import type { DependencyGraph, DependencyNode, DependencyEdge } from '../models/dependency-graph';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Represents the identity context extracted from a SigV4-signed request. */
export interface RequestIdentity {
  /** The IAM ARN of the requesting principal. */
  principalArn: string;
  /** The AWS account ID of the requesting principal. */
  accountId: string;
}

/** Context from an API Gateway event containing SigV4 identity information. */
export interface SigV4RequestContext {
  requestContext?: {
    identity?: {
      /** The IAM user ARN from the SigV4 signature. */
      userArn?: string;
      /** The AWS account ID from the SigV4 signature. */
      accountId?: string;
    };
    /** The caller ARN (alternative location in some API Gateway configurations). */
    authorizer?: {
      principalId?: string;
    };
  };
  /** Direct header-based ARN (for Lambda@Edge or custom authorizers). */
  headers?: Record<string, string | undefined>;
}

/** Authorization policy describing what accounts/regions a principal can access. */
export interface AuthorizationPolicy {
  /** List of AWS account IDs the principal is authorized to read. */
  authorizedAccounts: string[];
  /** List of AWS regions the principal is authorized to read. */
  authorizedRegions: string[];
}

/** Summary of accounts excluded from results due to insufficient permissions. */
export interface ExclusionSummary {
  /** Accounts that were excluded from results. */
  excludedAccounts: string[];
  /** Regions that were excluded from results. */
  excludedRegions: string[];
  /** Total number of resources omitted. */
  omittedResourceCount: number;
  /** Human-readable reason for exclusion. */
  reason: string;
}

/** Result of scoping a dependency graph to authorized boundaries. */
export interface ScopedGraphResult {
  /** The dependency graph with unauthorized resources removed. */
  graph: DependencyGraph;
  /** Summary of what was excluded. */
  exclusionSummary: ExclusionSummary;
}

/** Result of scoping scored resources to authorized boundaries. */
export interface ScopedResourcesResult {
  /** Scored resources with unauthorized entries removed. */
  resources: ScoredResource[];
  /** Summary of what was excluded. */
  exclusionSummary: ExclusionSummary;
}

/** Interface for resolving a principal's authorization policy. */
export interface AuthorizationResolver {
  /**
   * Resolves the authorization policy for a given principal.
   * Determines which accounts and regions the principal has read access to.
   */
  resolvePolicy(principalArn: string): Promise<AuthorizationPolicy>;
}

// ─── SigV4 Identity Extraction ───────────────────────────────────────────────

/**
 * Extracts the requesting principal's IAM ARN from a SigV4-signed API Gateway event.
 *
 * Looks for the principal ARN in the standard API Gateway request context locations:
 * 1. requestContext.identity.userArn (IAM auth)
 * 2. requestContext.authorizer.principalId (custom authorizer)
 *
 * @param event - The API Gateway event containing SigV4 identity context
 * @returns The extracted RequestIdentity, or null if authentication failed
 *
 * Validates: Requirements 9.1, 9.2
 */
export function extractPrincipalFromSigV4(
  event: SigV4RequestContext
): RequestIdentity | null {
  const identity = event.requestContext?.identity;

  // Primary: IAM-based SigV4 authentication via API Gateway
  if (identity?.userArn) {
    const accountId = identity.accountId ?? extractAccountFromArn(identity.userArn);
    if (accountId) {
      return {
        principalArn: identity.userArn,
        accountId,
      };
    }
  }

  // Fallback: Custom authorizer principal
  const principalId = event.requestContext?.authorizer?.principalId;
  if (principalId && isValidArn(principalId)) {
    const accountId = extractAccountFromArn(principalId);
    if (accountId) {
      return {
        principalArn: principalId,
        accountId,
      };
    }
  }

  // Authentication failed — no valid principal found
  return null;
}

// ─── Access Scoping ──────────────────────────────────────────────────────────

/**
 * Scopes a dependency graph to only include resources from authorized accounts/regions.
 * Removes nodes and edges for unauthorized resources and produces an exclusion summary.
 *
 * @param graph - The full dependency graph from resource discovery
 * @param policy - The authorization policy for the requesting principal
 * @returns The scoped graph and exclusion summary
 *
 * Validates: Requirements 9.3, 9.4, 9.5
 */
export function scopeDependencyGraph(
  graph: DependencyGraph,
  policy: AuthorizationPolicy
): ScopedGraphResult {
  const excludedAccounts = new Set<string>();
  const excludedRegions = new Set<string>();
  let omittedResourceCount = 0;

  // Partition nodes into authorized and unauthorized
  const authorizedNodeIds = new Set<string>();
  const authorizedNodes: DependencyNode[] = [];

  for (const node of graph.nodes) {
    if (isNodeAuthorized(node, policy)) {
      authorizedNodes.push(node);
      authorizedNodeIds.add(node.resourceId);
    } else {
      omittedResourceCount++;
      if (!isAccountAuthorized(node.accountId, policy)) {
        excludedAccounts.add(node.accountId);
      }
      if (!isRegionAuthorized(node.region, policy)) {
        excludedRegions.add(node.region);
      }
    }
  }

  // Filter edges to only include those between authorized nodes
  const authorizedEdges: DependencyEdge[] = graph.edges.filter(
    (edge) =>
      authorizedNodeIds.has(edge.sourceId) && authorizedNodeIds.has(edge.targetId)
  );

  const exclusionSummary: ExclusionSummary = {
    excludedAccounts: Array.from(excludedAccounts).sort(),
    excludedRegions: Array.from(excludedRegions).sort(),
    omittedResourceCount,
    reason:
      omittedResourceCount > 0
        ? `${omittedResourceCount} resource(s) omitted due to insufficient read permissions on ${excludedAccounts.size} account(s) and ${excludedRegions.size} region(s).`
        : 'All resources are within authorized scope.',
  };

  return {
    graph: {
      nodes: authorizedNodes,
      edges: authorizedEdges,
    },
    exclusionSummary,
  };
}

/**
 * Scopes scored resources to only include entries from authorized accounts/regions.
 * Removes scored resources for unauthorized accounts and produces an exclusion summary.
 *
 * @param resources - The full set of scored resources from risk assessment
 * @param policy - The authorization policy for the requesting principal
 * @returns The scoped resources and exclusion summary
 *
 * Validates: Requirements 9.3, 9.4, 9.5
 */
export function scopeScoredResources(
  resources: ScoredResource[],
  policy: AuthorizationPolicy
): ScopedResourcesResult {
  const excludedAccounts = new Set<string>();
  const excludedRegions = new Set<string>();
  let omittedResourceCount = 0;

  const authorizedResources: ScoredResource[] = [];

  for (const resource of resources) {
    if (isScoredResourceAuthorized(resource, policy)) {
      authorizedResources.push(resource);
    } else {
      omittedResourceCount++;
      if (!isAccountAuthorized(resource.accountId, policy)) {
        excludedAccounts.add(resource.accountId);
      }
      if (!isRegionAuthorized(resource.region, policy)) {
        excludedRegions.add(resource.region);
      }
    }
  }

  const exclusionSummary: ExclusionSummary = {
    excludedAccounts: Array.from(excludedAccounts).sort(),
    excludedRegions: Array.from(excludedRegions).sort(),
    omittedResourceCount,
    reason:
      omittedResourceCount > 0
        ? `${omittedResourceCount} resource(s) omitted due to insufficient read permissions on ${excludedAccounts.size} account(s) and ${excludedRegions.size} region(s).`
        : 'All resources are within authorized scope.',
  };

  return {
    resources: authorizedResources,
    exclusionSummary,
  };
}

/**
 * Determines the authorization scope for resource discovery.
 * Returns the list of accounts and regions that should be queried.
 *
 * @param principalArn - The IAM ARN of the requesting principal
 * @param resolver - The authorization resolver to determine policy
 * @returns The authorization policy for the principal
 *
 * Validates: Requirements 9.3
 */
export async function resolveAccessScope(
  principalArn: string,
  resolver: AuthorizationResolver
): Promise<AuthorizationPolicy> {
  return resolver.resolvePolicy(principalArn);
}

// ─── Authentication Error Response ──────────────────────────────────────────

/** Error response for failed SigV4 authentication. */
export interface AuthenticationError {
  statusCode: 401;
  error: 'Unauthorized';
  message: string;
}

/**
 * Creates a standardized authentication error response.
 * Does not reveal internal system details per Requirement 9.2.
 *
 * Validates: Requirements 9.2
 */
export function createAuthenticationError(): AuthenticationError {
  return {
    statusCode: 401,
    error: 'Unauthorized',
    message: 'Invalid or missing credentials. Ensure the request is signed with valid AWS SigV4 credentials.',
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Extracts the AWS account ID from an IAM ARN.
 * ARN format: arn:partition:service:region:account-id:resource
 */
function extractAccountFromArn(arn: string): string | null {
  const parts = arn.split(':');
  if (parts.length >= 5 && parts[0] === 'arn') {
    const accountId = parts[4];
    if (accountId && /^\d{12}$/.test(accountId)) {
      return accountId;
    }
  }
  return null;
}

/**
 * Validates that a string looks like a valid IAM ARN.
 */
function isValidArn(value: string): boolean {
  // Basic ARN format: arn:partition:service:region:account-id:resource
  return /^arn:[a-z-]+:[a-z0-9-]+:[a-z0-9-]*:\d{12}:.+$/.test(value);
}

/**
 * Checks if a dependency node is authorized based on the policy.
 */
function isNodeAuthorized(node: DependencyNode, policy: AuthorizationPolicy): boolean {
  return (
    isAccountAuthorized(node.accountId, policy) &&
    isRegionAuthorized(node.region, policy)
  );
}

/**
 * Checks if a scored resource is authorized based on the policy.
 */
function isScoredResourceAuthorized(
  resource: ScoredResource,
  policy: AuthorizationPolicy
): boolean {
  return (
    isAccountAuthorized(resource.accountId, policy) &&
    isRegionAuthorized(resource.region, policy)
  );
}

/**
 * Checks if an account is in the authorized accounts list.
 * If the authorized accounts list is empty, all accounts are considered authorized.
 */
function isAccountAuthorized(accountId: string, policy: AuthorizationPolicy): boolean {
  if (policy.authorizedAccounts.length === 0) {
    return true;
  }
  return policy.authorizedAccounts.includes(accountId);
}

/**
 * Checks if a region is in the authorized regions list.
 * If the authorized regions list is empty, all regions are considered authorized.
 */
function isRegionAuthorized(region: string, policy: AuthorizationPolicy): boolean {
  if (policy.authorizedRegions.length === 0) {
    return true;
  }
  return policy.authorizedRegions.includes(region);
}
