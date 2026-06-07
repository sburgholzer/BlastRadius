/**
 * Resource Resolver Lambda handler.
 *
 * Discovers resource dependencies by querying AWS Config relationship data
 * and Resource Explorer. Traverses the dependency graph recursively up to
 * a configurable max depth, detecting circular references via a visited-set.
 *
 * Marks resources with appropriate coverage levels (full, partial, unknown)
 * based on data completeness. Scopes queries to authorized accounts/regions.
 */

import type {
  SelectAggregateResourceConfigCommandOutput,
} from '@aws-sdk/client-config-service';
import type {
  SearchCommandOutput,
} from '@aws-sdk/client-resource-explorer-2';
import { ConfigServiceClient, SelectAggregateResourceConfigCommand } from '@aws-sdk/client-config-service';
import { ResourceExplorer2Client, SearchCommand } from '@aws-sdk/client-resource-explorer-2';
import type {
  ResourceChange,
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  DependencyCoverage,
} from '@blast-radius/core';
import { LRUCache } from '@blast-radius/core';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface ResolverInput {
  resources?: ResourceChange[];
  validatedManifest?: { resources: ResourceChange[]; [key: string]: unknown };
  maxDepth?: number;
  options?: { maxDepth?: number; [key: string]: unknown };
  requestingPrincipal?: string;
  authorizedAccounts?: string[];
  authorizedRegions?: string[];
  analysisId?: string;
  sourceFormat?: string;
  resourceCount?: number;
}

export interface CoverageReport {
  fullCoverage: number;
  partialCoverage: number;
  unknownCoverage: number;
}

export interface ResolverOutput {
  dependencyGraph: DependencyGraph;
  coverage: CoverageReport;
  cacheStats: { hits: number; misses: number };
}

/** A discovered relationship from AWS Config or Resource Explorer. */
export interface DiscoveredRelationship {
  resourceId: string;
  resourceType: string;
  relationshipType: string;
  region: string;
  accountId: string;
}

/** Dependencies for dependency injection (testability). */
export interface ResolverDeps {
  configClient: ConfigServiceClient;
  resourceExplorerClient: ResourceExplorer2Client;
  /** AWS Config aggregator name for advanced queries. */
  configAggregatorName: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MAX_DEPTH = 5;
const CACHE_MAX_SIZE = 10_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

const CONFIG_AGGREGATOR_NAME = process.env.CONFIG_AGGREGATOR_NAME ?? 'default';

function createDefaultDeps(): ResolverDeps {
  return {
    configClient: new ConfigServiceClient({}),
    resourceExplorerClient: new ResourceExplorer2Client({}),
    configAggregatorName: CONFIG_AGGREGATOR_NAME,
  };
}

// ─── Helper: Retry with exponential backoff ──────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, retries: number = MAX_RETRIES): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (attempt < retries - 1 && isRetryable(err)) {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
        await sleep(delay);
      } else if (!isRetryable(err)) {
        throw err;
      }
    }
  }
  throw lastError;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    return (
      message.includes('throttl') ||
      message.includes('rate exceeded') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('service unavailable')
    );
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Core: Query AWS Config for relationships ────────────────────────────────

async function queryConfigRelationships(
  resourceId: string,
  deps: ResolverDeps,
): Promise<DiscoveredRelationship[]> {
  const query = `
    SELECT
      relationships.resourceId,
      relationships.resourceType,
      relationships.name,
      awsRegion,
      accountId
    WHERE
      resourceId = '${resourceId}'
  `;

  const response: SelectAggregateResourceConfigCommandOutput = await withRetry(() =>
    deps.configClient.send(
      new SelectAggregateResourceConfigCommand({
        ConfigurationAggregatorName: deps.configAggregatorName,
        Expression: query,
      }),
    ),
  );

  const results: DiscoveredRelationship[] = [];

  if (response.Results) {
    for (const resultStr of response.Results) {
      try {
        const parsed = JSON.parse(resultStr);
        if (parsed.relationships && Array.isArray(parsed.relationships)) {
          for (const rel of parsed.relationships) {
            if (!rel.resourceId) continue;
            results.push({
              resourceId: rel.resourceId,
              resourceType: rel.resourceType ?? 'Unknown',
              relationshipType: rel.name ?? 'related_to',
              region: parsed.awsRegion ?? 'unknown',
              accountId: parsed.accountId ?? 'unknown',
            });
          }
        }
      } catch {
        // Skip malformed results
      }
    }
  }

  return results;
}

// ─── Core: Query Resource Explorer for cross-account/cross-region ────────────

async function queryResourceExplorer(
  resourceId: string,
  deps: ResolverDeps,
): Promise<DiscoveredRelationship[]> {
  const response: SearchCommandOutput = await withRetry(() =>
    deps.resourceExplorerClient.send(
      new SearchCommand({
        QueryString: `id:${resourceId}`,
      }),
    ),
  );

  const results: DiscoveredRelationship[] = [];

  if (response.Resources) {
    for (const resource of response.Resources) {
      if (resource.Arn && resource.ResourceType) {
        results.push({
          resourceId: resource.Arn,
          resourceType: resource.ResourceType,
          relationshipType: 'cross_account_reference',
          region: resource.Region ?? 'unknown',
          accountId: resource.OwningAccountId ?? 'unknown',
        });
      }
    }
  }

  return results;
}

// ─── Core: Determine coverage level ─────────────────────────────────────────

function determineCoverage(
  configResults: DiscoveredRelationship[],
  explorerResults: DiscoveredRelationship[],
  configError: boolean,
  explorerError: boolean,
): DependencyCoverage {
  if (configError && explorerError) {
    return 'unknown';
  }
  if (configError || explorerError) {
    return 'partial';
  }
  if (configResults.length === 0 && explorerResults.length === 0) {
    // No relationships found but no errors — could be a leaf node with full coverage
    return 'full';
  }
  return 'full';
}

// ─── Core: Check authorization scope ─────────────────────────────────────────

function isAuthorized(
  accountId: string,
  region: string,
  authorizedAccounts: string[] | undefined,
  authorizedRegions: string[] | undefined,
): boolean {
  if (authorizedAccounts && authorizedAccounts.length > 0) {
    if (!authorizedAccounts.includes(accountId)) {
      return false;
    }
  }
  if (authorizedRegions && authorizedRegions.length > 0) {
    if (!authorizedRegions.includes(region)) {
      return false;
    }
  }
  return true;
}

// ─── Core: Recursive graph traversal ─────────────────────────────────────────

interface TraversalContext {
  nodes: Map<string, DependencyNode>;
  edges: DependencyEdge[];
  visited: Set<string>;
  cache: LRUCache<string, DiscoveredRelationship[]>;
  deps: ResolverDeps;
  authorizedAccounts: string[] | undefined;
  authorizedRegions: string[] | undefined;
  maxDepth: number;
}

async function traverseDependencies(
  resourceId: string,
  resourceType: string,
  provider: string,
  region: string,
  accountId: string,
  currentDepth: number,
  isDirectChange: boolean,
  ctx: TraversalContext,
): Promise<void> {
  // Circular reference detection
  if (ctx.visited.has(resourceId)) {
    return;
  }

  // Depth limit check
  if (currentDepth > ctx.maxDepth) {
    return;
  }

  ctx.visited.add(resourceId);

  // Check authorization
  if (!isAuthorized(accountId, region, ctx.authorizedAccounts, ctx.authorizedRegions)) {
    return;
  }

  // Try cache first for relationships
  let configResults: DiscoveredRelationship[] = [];
  let explorerResults: DiscoveredRelationship[] = [];
  let configError = false;
  let explorerError = false;

  const cacheKey = `config:${resourceId}`;
  const explorerCacheKey = `explorer:${resourceId}`;

  // Query AWS Config (with cache)
  const cachedConfig = ctx.cache.get(cacheKey);
  if (cachedConfig !== undefined) {
    configResults = cachedConfig;
  } else {
    try {
      configResults = await queryConfigRelationships(resourceId, ctx.deps);
      ctx.cache.set(cacheKey, configResults);
    } catch {
      configError = true;
      ctx.cache.set(cacheKey, []);
    }
  }

  // Query Resource Explorer (with cache)
  const cachedExplorer = ctx.cache.get(explorerCacheKey);
  if (cachedExplorer !== undefined) {
    explorerResults = cachedExplorer;
  } else {
    try {
      explorerResults = await queryResourceExplorer(resourceId, ctx.deps);
      ctx.cache.set(explorerCacheKey, explorerResults);
    } catch {
      explorerError = true;
      ctx.cache.set(explorerCacheKey, []);
    }
  }

  // Determine coverage
  const coverage = determineCoverage(configResults, explorerResults, configError, explorerError);

  // Add node to graph
  const node: DependencyNode = {
    resourceId,
    resourceType,
    provider,
    region,
    accountId,
    isDirectChange,
    dependencyCoverage: coverage,
  };
  ctx.nodes.set(resourceId, node);

  // Combine all discovered relationships
  const allRelationships = [...configResults, ...explorerResults];

  // Traverse each dependency recursively
  for (const rel of allRelationships) {
    // Skip unauthorized resources
    if (!isAuthorized(rel.accountId, rel.region, ctx.authorizedAccounts, ctx.authorizedRegions)) {
      continue;
    }

    // Skip edges with missing target
    if (!rel.resourceId) {
      continue;
    }

    // Add edge
    const edge: DependencyEdge = {
      sourceId: resourceId,
      targetId: rel.resourceId,
      relationshipType: rel.relationshipType,
      depth: currentDepth,
    };
    ctx.edges.push(edge);

    // Recurse into dependency
    await traverseDependencies(
      rel.resourceId,
      rel.resourceType,
      provider, // inherit provider from parent
      rel.region,
      rel.accountId,
      currentDepth + 1,
      false,
      ctx,
    );
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Resource Resolver Lambda handler.
 *
 * Discovers all downstream dependencies for the given resources by querying
 * AWS Config and Resource Explorer. Returns a complete dependency graph with
 * coverage report and cache statistics.
 */
export async function handler(
  event: ResolverInput,
  deps?: ResolverDeps,
): Promise<ResolverOutput> {
  const resolvedDeps = deps && 'configClient' in deps ? deps : createDefaultDeps();
  const maxDepth = event.maxDepth ?? event.options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const resources = event.resources ?? event.validatedManifest?.resources ?? [];
  const cache = new LRUCache<string, DiscoveredRelationship[]>(CACHE_MAX_SIZE);

  const ctx: TraversalContext = {
    nodes: new Map(),
    edges: [],
    visited: new Set(),
    cache,
    deps: resolvedDeps,
    authorizedAccounts: event.authorizedAccounts,
    authorizedRegions: event.authorizedRegions,
    maxDepth,
  };

  // Traverse dependencies for each resource in the manifest
  for (const resource of resources) {
    await traverseDependencies(
      resource.resourceId,
      resource.resourceType,
      resource.provider,
      resource.region ?? 'us-east-1',
      resource.accountId ?? 'unknown',
      1,
      true,
      ctx,
    );
  }

  // Build dependency graph
  const dependencyGraph: DependencyGraph = {
    nodes: Array.from(ctx.nodes.values()),
    edges: ctx.edges,
  };

  // Compute coverage report
  const coverageReport = computeCoverageReport(dependencyGraph.nodes);

  // Get cache stats
  const stats = cache.getStats();

  return {
    dependencyGraph,
    coverage: coverageReport,
    cacheStats: { hits: stats.hits, misses: stats.misses },
  };
}

// ─── Helper: Compute coverage report ────────────────────────────────────────

function computeCoverageReport(nodes: DependencyNode[]): CoverageReport {
  let fullCoverage = 0;
  let partialCoverage = 0;
  let unknownCoverage = 0;

  for (const node of nodes) {
    switch (node.dependencyCoverage) {
      case 'full':
        fullCoverage++;
        break;
      case 'partial':
        partialCoverage++;
        break;
      case 'unknown':
        unknownCoverage++;
        break;
    }
  }

  return { fullCoverage, partialCoverage, unknownCoverage };
}
