import { useEffect, useRef, useCallback, useState } from 'react';
import cytoscape, { type Core, type EventObject } from 'cytoscape';
import type {
  DependencyGraph as DependencyGraphData,
  DependencyNode,
  ScoredResource,
  RiskCategory,
} from '../api/types';

/** Color mapping for risk categories. */
const RISK_COLORS: Record<RiskCategory, string> = {
  Critical: '#e53e3e',
  High: '#dd6b20',
  Medium: '#d69e2e',
  Low: '#38a169',
};

/** Border color for directly changed resources. */
const DIRECT_CHANGE_BORDER = '#2b6cb0';

export interface SelectedNodeDetails {
  resourceId: string;
  resourceType: string;
  impactScore: number;
  riskCategory: RiskCategory;
  dependencyChain: string[];
  region: string;
  accountId: string;
  provider: string;
  isDirectChange: boolean;
  dependencyCoverage: string;
}

export interface DependencyGraphProps {
  /** The dependency graph data with nodes and edges. */
  graph: DependencyGraphData;
  /** Scored resources for color-coding and detail display. */
  scoredResources: ScoredResource[];
  /** Callback when a node is selected. */
  onNodeSelect?: (details: SelectedNodeDetails | null) => void;
  /** Optional CSS class name for the container. */
  className?: string;
}

/**
 * Resolves the risk category for a given node by looking up its score.
 * Directly changed nodes default to 'Critical' if not scored.
 */
function getRiskCategory(
  node: DependencyNode,
  scoredMap: Map<string, ScoredResource>
): RiskCategory {
  const scored = scoredMap.get(node.resourceId);
  if (scored) return scored.riskCategory;
  if (node.isDirectChange) return 'Critical';
  return 'Low';
}

/**
 * Interactive dependency graph visualization using Cytoscape.js.
 *
 * Supports zoom, pan, and node selection. Nodes are color-coded by risk category:
 * - Critical: red
 * - High: orange
 * - Medium: yellow
 * - Low: green
 *
 * Selecting a node displays resource details including type, ID, impact score,
 * and the full dependency chain.
 */
export function DependencyGraph({
  graph,
  scoredResources,
  onNodeSelect,
  className,
}: DependencyGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedNode, setSelectedNode] = useState<SelectedNodeDetails | null>(
    null
  );

  // Build a lookup map for scored resources
  const scoredMap = useRef<Map<string, ScoredResource>>(new Map());
  useEffect(() => {
    const map = new Map<string, ScoredResource>();
    for (const sr of scoredResources) {
      map.set(sr.resourceId, sr);
    }
    scoredMap.current = map;
  }, [scoredResources]);

  const handleNodeTap = useCallback(
    (event: EventObject) => {
      const nodeData = event.target.data();
      const resourceId = nodeData.id as string;
      const node = graph.nodes.find((n) => n.resourceId === resourceId);
      const scored = scoredMap.current.get(resourceId);

      if (!node) return;

      const details: SelectedNodeDetails = {
        resourceId: node.resourceId,
        resourceType: node.resourceType,
        impactScore: scored?.impactScore ?? 0,
        riskCategory: scored?.riskCategory ?? (node.isDirectChange ? 'Critical' : 'Low'),
        dependencyChain: scored?.dependencyChain ?? [node.resourceId],
        region: node.region,
        accountId: node.accountId,
        provider: node.provider,
        isDirectChange: node.isDirectChange,
        dependencyCoverage: node.dependencyCoverage,
      };

      setSelectedNode(details);
      onNodeSelect?.(details);
    },
    [graph.nodes, onNodeSelect]
  );

  const handleBackgroundTap = useCallback(() => {
    setSelectedNode(null);
    onNodeSelect?.(null);
  }, [onNodeSelect]);

  // Initialize and update Cytoscape instance
  useEffect(() => {
    if (!containerRef.current) return;

    const map = scoredMap.current;

    // Build Cytoscape elements
    const elements: cytoscape.ElementDefinition[] = [
      ...graph.nodes.map((node) => {
        const riskCategory = getRiskCategory(node, map);
        return {
          data: {
            id: node.resourceId,
            label: `${node.resourceType}\n${node.resourceId.slice(-12)}`,
            riskCategory,
            isDirectChange: node.isDirectChange,
            resourceType: node.resourceType,
          },
        };
      }),
      ...graph.edges.map((edge, index) => ({
        data: {
          id: `edge-${index}`,
          source: edge.sourceId,
          target: edge.targetId,
          relationshipType: edge.relationshipType,
        },
      })),
    ];

    // Destroy previous instance if it exists
    if (cyRef.current) {
      cyRef.current.destroy();
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'text-wrap': 'wrap',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '10px',
            width: 60,
            height: 60,
            'background-color': (ele) => {
              const category = ele.data('riskCategory') as RiskCategory;
              return RISK_COLORS[category] || RISK_COLORS.Low;
            },
            'border-width': (ele) => (ele.data('isDirectChange') ? 4 : 2),
            'border-color': (ele) =>
              ele.data('isDirectChange')
                ? DIRECT_CHANGE_BORDER
                : '#718096',
            color: '#1a202c',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 5,
            'border-color': '#2d3748',
            'overlay-opacity': 0.1,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': '#a0aec0',
            'target-arrow-color': '#a0aec0',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 0.8,
          },
        },
        {
          selector: 'edge:selected',
          style: {
            'line-color': '#4a5568',
            'target-arrow-color': '#4a5568',
            width: 3,
          },
        },
      ],
      layout: {
        name: 'cose',
        animate: false,
        nodeDimensionsIncludeLabels: true,
        idealEdgeLength: () => 120,
        nodeRepulsion: () => 8000,
        gravity: 0.25,
      },
      // Enable zoom and pan
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      minZoom: 0.2,
      maxZoom: 5,
    });

    // Attach event listeners
    cy.on('tap', 'node', handleNodeTap);
    cy.on('tap', (event) => {
      if (event.target === cy) {
        handleBackgroundTap();
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph, scoredResources, handleNodeTap, handleBackgroundTap]);

  return (
    <div className={`dependency-graph-container ${className ?? ''}`}>
      <div
        ref={containerRef}
        className="dependency-graph-canvas"
        style={{ width: '100%', height: '500px', border: '1px solid #e2e8f0' }}
        role="img"
        aria-label="Dependency graph visualization showing resource relationships and risk levels"
      />
      {selectedNode && (
        <div className="dependency-graph-details" role="region" aria-label="Selected resource details">
          <h3>Resource Details</h3>
          <dl className="details-list">
            <dt>Resource ID</dt>
            <dd>{selectedNode.resourceId}</dd>

            <dt>Resource Type</dt>
            <dd>{selectedNode.resourceType}</dd>

            <dt>Impact Score</dt>
            <dd>{selectedNode.impactScore}</dd>

            <dt>Risk Category</dt>
            <dd>
              <span
                className={`risk-badge risk-${selectedNode.riskCategory.toLowerCase()}`}
                style={{ color: RISK_COLORS[selectedNode.riskCategory] }}
              >
                {selectedNode.riskCategory}
              </span>
            </dd>

            <dt>Region</dt>
            <dd>{selectedNode.region}</dd>

            <dt>Account</dt>
            <dd>{selectedNode.accountId}</dd>

            <dt>Provider</dt>
            <dd>{selectedNode.provider}</dd>

            <dt>Direct Change</dt>
            <dd>{selectedNode.isDirectChange ? 'Yes' : 'No'}</dd>

            <dt>Coverage</dt>
            <dd>{selectedNode.dependencyCoverage}</dd>

            <dt>Dependency Chain</dt>
            <dd>
              <ol className="dependency-chain">
                {selectedNode.dependencyChain.map((id, idx) => (
                  <li key={`${id}-${idx}`}>{id}</li>
                ))}
              </ol>
            </dd>
          </dl>
        </div>
      )}
    </div>
  );
}
