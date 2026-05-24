/**
 * Risk Assessor Lambda handler.
 *
 * Computes Impact_Score for each affected resource in the dependency graph
 * and classifies resources into risk categories.
 *
 * Scoring formula:
 *   Impact_Score = round((depthScore * 0.30) + (criticalityScore * 0.40) + (changeTypeSeverity * 0.30))
 *
 * Where:
 *   depthScore = max(10, 100 - ((depth - 1) * 10))
 *   criticalityScore = { Critical: 100, High: 75, Medium: 50, Low: 25 }
 *   changeTypeSeverity = { Remove: 100, Replace: 80, Modify: 50, Add: 30 }
 */

import type {
  DependencyGraph,
  DependencyEdge,
  DependencyNode,
  ResourceChangeManifest,
  ScoredResource,
  RiskSummary,
  RiskCategory,
  CriticalityClassification,
  ModificationType,
} from '@blast-radius/core';
import { createCriticalityConfig } from '@blast-radius/core';

export interface AssessorInput {
  dependencyGraph: DependencyGraph;
  manifest: ResourceChangeManifest;
}

export interface AssessorOutput {
  scoredResources: ScoredResource[];
  riskSummary: RiskSummary;
}

/** Map criticality classification to numeric score. */
const CRITICALITY_SCORES: Record<CriticalityClassification, number> = {
  Critical: 100,
  High: 75,
  Medium: 50,
  Low: 25,
};

/** Map change type to severity score. */
const CHANGE_TYPE_SEVERITY: Record<ModificationType, number> = {
  Remove: 100,
  Replace: 80,
  Modify: 50,
  Add: 30,
};

/**
 * Compute depth score: max(10, 100 - ((depth - 1) * 10))
 * depth 1 = 100, depth 2 = 90, ..., depth 10+ = 10
 */
export function computeDepthScore(depth: number): number {
  return Math.max(10, 100 - (depth - 1) * 10);
}

/**
 * Compute Impact_Score from component scores.
 * Formula: round((depthScore * 0.30) + (criticalityScore * 0.40) + (changeTypeSeverity * 0.30))
 */
export function computeImpactScore(
  depthScore: number,
  criticalityScore: number,
  changeTypeSeverity: number,
): number {
  return Math.round(depthScore * 0.3 + criticalityScore * 0.4 + changeTypeSeverity * 0.3);
}

/** Classify an impact score into a risk category. */
export function classifyRisk(score: number): RiskCategory {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Medium';
  return 'Low';
}

/**
 * Find all paths from any directly-changed resource to a target resource.
 * Returns paths as arrays of resource IDs (from source to target).
 */
function findPathsToResource(
  targetId: string,
  graph: DependencyGraph,
  directChangeIds: Set<string>,
): { chain: string[]; edges: DependencyEdge[]; maxDepth: number }[] {
  const adjacency = new Map<string, DependencyEdge[]>();
  for (const edge of graph.edges) {
    const existing = adjacency.get(edge.sourceId) ?? [];
    existing.push(edge);
    adjacency.set(edge.sourceId, existing);
  }

  const paths: { chain: string[]; edges: DependencyEdge[]; maxDepth: number }[] = [];

  // BFS/DFS from each direct change node to find paths to target
  for (const sourceId of directChangeIds) {
    const queue: { nodeId: string; chain: string[]; edges: DependencyEdge[]; maxDepth: number }[] =
      [{ nodeId: sourceId, chain: [sourceId], edges: [], maxDepth: 0 }];
    const visited = new Set<string>();
    visited.add(sourceId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.nodeId === targetId && current.chain.length > 1) {
        paths.push({
          chain: current.chain,
          edges: current.edges,
          maxDepth: current.maxDepth,
        });
        continue;
      }

      const neighbors = adjacency.get(current.nodeId) ?? [];
      for (const edge of neighbors) {
        if (!visited.has(edge.targetId)) {
          visited.add(edge.targetId);
          queue.push({
            nodeId: edge.targetId,
            chain: [...current.chain, edge.targetId],
            edges: [...current.edges, edge],
            maxDepth: Math.max(current.maxDepth, edge.depth),
          });
        }
      }
    }
  }

  return paths;
}

/**
 * Get the minimum depth from any directly-changed resource to the target
 * by examining edges in the graph.
 */
function getMinDepthForResource(
  targetId: string,
  graph: DependencyGraph,
): number {
  // Find the minimum depth edge pointing to this resource
  const incomingEdges = graph.edges.filter((e) => e.targetId === targetId);
  if (incomingEdges.length === 0) return 1;
  return Math.min(...incomingEdges.map((e) => e.depth));
}

/**
 * Risk Assessor Lambda handler.
 *
 * Scores each affected (non-directly-changed) resource in the dependency graph
 * and produces a risk summary.
 */
export async function handler(input: AssessorInput): Promise<AssessorOutput> {
  const { dependencyGraph, manifest } = input;
  const criticalityConfig = createCriticalityConfig();

  // Identify directly changed resources from the manifest
  const directChangeIds = new Set<string>(manifest.resources.map((r) => r.resourceId));

  // Build a map of modification types from the manifest
  const modificationTypeMap = new Map<string, ModificationType>();
  for (const resource of manifest.resources) {
    modificationTypeMap.set(resource.resourceId, resource.modificationType);
  }

  // Build node lookup
  const nodeMap = new Map<string, DependencyNode>();
  for (const node of dependencyGraph.nodes) {
    nodeMap.set(node.resourceId, node);
  }

  // Score each affected resource (non-direct-change nodes in the graph)
  const scoredResources: ScoredResource[] = [];

  for (const node of dependencyGraph.nodes) {
    if (directChangeIds.has(node.resourceId)) {
      continue; // Skip directly changed resources — they are the source, not affected
    }

    // Find all paths from direct changes to this resource
    const paths = findPathsToResource(node.resourceId, dependencyGraph, directChangeIds);

    if (paths.length === 0) {
      // No path from a direct change — use edge depth info
      const depth = getMinDepthForResource(node.resourceId, dependencyGraph);
      const depthScore = computeDepthScore(depth);
      const criticality = criticalityConfig.getCriticality(node.resourceType);
      const criticalityScore = CRITICALITY_SCORES[criticality];

      // Determine change type severity from the closest direct change
      // Default to Modify if we can't determine the source
      const changeTypeSev = CHANGE_TYPE_SEVERITY['Modify'];

      const impactScore = computeImpactScore(depthScore, criticalityScore, changeTypeSev);
      const riskCategory = classifyRisk(impactScore);

      scoredResources.push({
        resourceId: node.resourceId,
        resourceType: node.resourceType,
        provider: node.provider,
        region: node.region,
        accountId: node.accountId,
        impactScore,
        riskCategory,
        dependencyChain: [node.resourceId],
        dependencyDepth: depth,
        criticalityClassification: criticality,
        changeTypeSeverity: changeTypeSev,
        highestRiskPath: [],
      });
      continue;
    }

    // Multi-path handling: compute score for each path, use the highest
    let bestScore = -1;
    let bestScoredResource: ScoredResource | null = null;

    for (const path of paths) {
      // The source of this path is a directly changed resource
      const sourceId = path.chain[0];
      const modType = modificationTypeMap.get(sourceId) ?? 'Modify';
      const changeTypeSev = CHANGE_TYPE_SEVERITY[modType];

      // Depth is the number of hops from source to target (chain length - 1)
      const depth = path.chain.length - 1;
      const depthScore = computeDepthScore(depth);

      const criticality = criticalityConfig.getCriticality(node.resourceType);
      const criticalityScore = CRITICALITY_SCORES[criticality];

      const impactScore = computeImpactScore(depthScore, criticalityScore, changeTypeSev);

      if (impactScore > bestScore) {
        bestScore = impactScore;
        bestScoredResource = {
          resourceId: node.resourceId,
          resourceType: node.resourceType,
          provider: node.provider,
          region: node.region,
          accountId: node.accountId,
          impactScore,
          riskCategory: classifyRisk(impactScore),
          dependencyChain: path.chain,
          dependencyDepth: depth,
          criticalityClassification: criticality,
          changeTypeSeverity: changeTypeSev,
          highestRiskPath: path.edges,
        };
      }
    }

    if (bestScoredResource) {
      scoredResources.push(bestScoredResource);
    }
  }

  // Compute risk summary
  const riskSummary = computeRiskSummary(scoredResources);

  return { scoredResources, riskSummary };
}

/** Compute the risk summary from scored resources. */
export function computeRiskSummary(scoredResources: ScoredResource[]): RiskSummary {
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let highestScore = 0;

  for (const resource of scoredResources) {
    switch (resource.riskCategory) {
      case 'Critical':
        critical++;
        break;
      case 'High':
        high++;
        break;
      case 'Medium':
        medium++;
        break;
      case 'Low':
        low++;
        break;
    }
    if (resource.impactScore > highestScore) {
      highestScore = resource.impactScore;
    }
  }

  return {
    critical,
    high,
    medium,
    low,
    totalAffected: scoredResources.length,
    highestScore,
  };
}
