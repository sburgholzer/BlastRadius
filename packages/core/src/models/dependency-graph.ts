/**
 * Dependency graph data models.
 *
 * Represents the directed graph of resource relationships discovered
 * by the Resource Resolver during dependency analysis.
 */

/** Coverage level indicating completeness of dependency data for a node. */
export type DependencyCoverage = 'full' | 'partial' | 'unknown';

/** A node in the dependency graph representing a single resource. */
export interface DependencyNode {
  resourceId: string;
  resourceType: string;
  provider: string;
  region: string;
  accountId: string;
  isDirectChange: boolean;
  dependencyCoverage: DependencyCoverage;
}

/** An edge in the dependency graph representing a relationship between resources. */
export interface DependencyEdge {
  sourceId: string;
  targetId: string;
  relationshipType: string;
  depth: number;
}

/** The complete dependency graph with nodes and edges. */
export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}
