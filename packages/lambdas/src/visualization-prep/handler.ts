/**
 * Visualization Prep Lambda handler.
 *
 * Transforms the scored dependency graph into a format optimized for frontend
 * rendering (node/edge lists with layout hints). Stores visualization-ready
 * results in S3 under the analysis ID.
 *
 * Layout hints include:
 * - Node size based on impact score
 * - Node color based on risk category
 * - Node grouping by region/account
 * - Edge thickness based on relationship depth
 * - Suggested layout algorithm (hierarchical for DAGs, force-directed for cyclic)
 *
 * Requirements: 5.6, 6.1
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type {
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  ScoredResource,
  RiskSummary,
  RiskCategory,
} from '@blast-radius/core';

/** Color mapping for risk categories (used by frontend). */
const RISK_CATEGORY_COLORS: Record<RiskCategory, string> = {
  Critical: '#dc2626', // red
  High: '#ea580c', // orange
  Medium: '#ca8a04', // yellow
  Low: '#16a34a', // green
};

/** Node size scaling based on impact score (0-100 → 20-60 px radius). */
function computeNodeSize(impactScore: number): number {
  return 20 + (impactScore / 100) * 40;
}

/** Edge thickness based on depth (depth 1 = thickest, depth 10 = thinnest). */
function computeEdgeThickness(depth: number): number {
  return Math.max(1, 6 - (depth - 1) * 0.5);
}

/** A visualization-ready node with layout hints. */
export interface VisualizationNode {
  id: string;
  resourceType: string;
  provider: string;
  region: string;
  accountId: string;
  isDirectChange: boolean;
  impactScore: number | null;
  riskCategory: RiskCategory | null;
  dependencyChain: string[];
  color: string;
  size: number;
  group: string;
}

/** A visualization-ready edge with layout hints. */
export interface VisualizationEdge {
  source: string;
  target: string;
  relationshipType: string;
  depth: number;
  thickness: number;
}

/** Layout metadata for the frontend rendering engine. */
export interface LayoutHints {
  algorithm: 'hierarchical' | 'force-directed';
  direction: 'top-down' | 'left-right';
  nodeSpacing: number;
  rankSpacing: number;
  groups: VisualizationGroup[];
}

/** A group of nodes for visual clustering. */
export interface VisualizationGroup {
  id: string;
  label: string;
  nodeIds: string[];
}

/** The complete visualization-ready payload stored in S3. */
export interface VisualizationResult {
  analysisId: string;
  generatedAt: string;
  nodes: VisualizationNode[];
  edges: VisualizationEdge[];
  layout: LayoutHints;
  riskSummary: RiskSummary;
  metadata: {
    totalNodes: number;
    totalEdges: number;
    directChanges: number;
    affectedResources: number;
  };
}

/** Input to the Visualization Prep Lambda. */
export interface VisualizationPrepInput {
  analysisId: string;
  dependencyGraph: DependencyGraph;
  scoredResources: ScoredResource[];
  riskSummary: RiskSummary;
}

/** Output from the Visualization Prep Lambda. */
export interface VisualizationPrepOutput {
  analysisId: string;
  s3Key: string;
  totalNodes: number;
  totalEdges: number;
}

/** Error response. */
export interface VisualizationPrepError {
  error: string;
  statusCode: number;
}

/** Result type from the handler. */
export type VisualizationPrepResult = VisualizationPrepOutput | VisualizationPrepError;

/** Dependencies injectable for testing. */
export interface VisualizationPrepDeps {
  s3Client: S3Client;
}

/** Environment variable for the S3 results bucket name. */
const RESULTS_BUCKET = process.env.RESULTS_BUCKET ?? 'blast-radius-results';

function createDefaultDeps(): VisualizationPrepDeps {
  return { s3Client: new S3Client({}) };
}

/**
 * Detect whether the graph contains cycles.
 * If cycles exist, force-directed layout is preferred; otherwise hierarchical.
 */
function hasCycles(graph: DependencyGraph): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const neighbors = adjacency.get(edge.sourceId) ?? [];
    neighbors.push(edge.targetId);
    adjacency.set(edge.sourceId, neighbors);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    inStack.add(nodeId);

    const neighbors = adjacency.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      if (inStack.has(neighbor)) return true;
      if (!visited.has(neighbor) && dfs(neighbor)) return true;
    }

    inStack.delete(nodeId);
    return false;
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.resourceId)) {
      if (dfs(node.resourceId)) return true;
    }
  }

  return false;
}

/**
 * Build visualization nodes from the dependency graph and scored resources.
 */
function buildVisualizationNodes(
  graph: DependencyGraph,
  scoredResources: ScoredResource[],
): VisualizationNode[] {
  // Build a lookup map for scored resources
  const scoreMap = new Map<string, ScoredResource>();
  for (const sr of scoredResources) {
    scoreMap.set(sr.resourceId, sr);
  }

  return graph.nodes.map((node: DependencyNode) => {
    const scored = scoreMap.get(node.resourceId);
    const impactScore = scored?.impactScore ?? null;
    const riskCategory = scored?.riskCategory ?? null;
    const dependencyChain = scored?.dependencyChain ?? [];

    // Direct changes get a neutral blue color; affected resources get risk-based color
    const color = node.isDirectChange
      ? '#2563eb' // blue for direct changes
      : riskCategory
        ? RISK_CATEGORY_COLORS[riskCategory]
        : '#6b7280'; // gray for unscored

    const size = node.isDirectChange
      ? 50 // fixed size for direct changes
      : computeNodeSize(impactScore ?? 0);

    // Group by region and account for visual clustering
    const group = `${node.accountId}/${node.region}`;

    return {
      id: node.resourceId,
      resourceType: node.resourceType,
      provider: node.provider,
      region: node.region,
      accountId: node.accountId,
      isDirectChange: node.isDirectChange,
      impactScore,
      riskCategory,
      dependencyChain,
      color,
      size,
      group,
    };
  });
}

/**
 * Build visualization edges from the dependency graph.
 */
function buildVisualizationEdges(graph: DependencyGraph): VisualizationEdge[] {
  return graph.edges.map((edge: DependencyEdge) => ({
    source: edge.sourceId,
    target: edge.targetId,
    relationshipType: edge.relationshipType,
    depth: edge.depth,
    thickness: computeEdgeThickness(edge.depth),
  }));
}

/**
 * Build groups for visual clustering based on account/region combinations.
 */
function buildGroups(nodes: VisualizationNode[]): VisualizationGroup[] {
  const groupMap = new Map<string, string[]>();

  for (const node of nodes) {
    const existing = groupMap.get(node.group) ?? [];
    existing.push(node.id);
    groupMap.set(node.group, existing);
  }

  return Array.from(groupMap.entries()).map(([groupId, nodeIds]) => {
    const [accountId, region] = groupId.split('/');
    return {
      id: groupId,
      label: `${accountId} / ${region}`,
      nodeIds,
    };
  });
}

/**
 * Visualization Prep Lambda handler.
 *
 * Transforms the scored dependency graph into visualization-ready format
 * and stores the result in S3.
 */
export async function handler(
  input: VisualizationPrepInput,
  deps?: VisualizationPrepDeps,
): Promise<VisualizationPrepResult> {
  const { s3Client } = deps && 's3Client' in deps ? deps : createDefaultDeps();

  // Validate input
  if (!input || typeof input !== 'object') {
    return { error: 'Invalid input: expected an object', statusCode: 400 };
  }
  if (!input.analysisId || typeof input.analysisId !== 'string') {
    return { error: 'Missing or invalid "analysisId" field', statusCode: 400 };
  }
  if (!input.dependencyGraph || !Array.isArray(input.dependencyGraph.nodes) || !Array.isArray(input.dependencyGraph.edges)) {
    return { error: 'Missing or invalid "dependencyGraph" field', statusCode: 400 };
  }
  if (!Array.isArray(input.scoredResources)) {
    return { error: 'Missing or invalid "scoredResources" field', statusCode: 400 };
  }
  if (!input.riskSummary || typeof input.riskSummary !== 'object') {
    return { error: 'Missing or invalid "riskSummary" field', statusCode: 400 };
  }

  const { analysisId, dependencyGraph, scoredResources, riskSummary } = input;

  // Build visualization nodes and edges
  const nodes = buildVisualizationNodes(dependencyGraph, scoredResources);
  const edges = buildVisualizationEdges(dependencyGraph);
  const groups = buildGroups(nodes);

  // Determine layout algorithm based on graph structure
  const cyclic = hasCycles(dependencyGraph);
  const layout: LayoutHints = {
    algorithm: cyclic ? 'force-directed' : 'hierarchical',
    direction: 'top-down',
    nodeSpacing: 80,
    rankSpacing: 120,
    groups,
  };

  // Count direct changes
  const directChanges = dependencyGraph.nodes.filter((n) => n.isDirectChange).length;

  // Assemble the visualization result
  const result: VisualizationResult = {
    analysisId,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    layout,
    riskSummary,
    metadata: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      directChanges,
      affectedResources: scoredResources.length,
    },
  };

  // Store in S3
  const s3Key = `analyses/${analysisId}/visualization.json`;

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: RESULTS_BUCKET,
        Key: s3Key,
        Body: JSON.stringify(result),
        ContentType: 'application/json',
      }),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error storing visualization result';
    return { error: `Failed to store visualization result in S3: ${message}`, statusCode: 500 };
  }

  return {
    analysisId,
    s3Key,
    totalNodes: nodes.length,
    totalEdges: edges.length,
  };
}
