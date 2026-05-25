import { useEffect, useRef, useCallback, useState } from 'react';
import cytoscape, { type Core, type EventObject } from 'cytoscape';
import type {
  DependencyGraph as DependencyGraphData,
  DependencyNode,
  ScoredResource,
  RiskCategory,
} from '../api/types';
import { GraphLegend } from './GraphLegend';

/** Color mapping for risk categories. */
const RISK_COLORS: Record<RiskCategory, string> = {
  Critical: '#e53e3e',
  High: '#dd6b20',
  Medium: '#d69e2e',
  Low: '#38a169',
};

/** Border color for directly changed resources. */
const DIRECT_CHANGE_BORDER = '#2b6cb0';

/** Available graph layout options. */
type LayoutOption = 'auto' | 'hierarchical' | 'force' | 'circle' | 'grid';

const LAYOUT_CONFIGS: Record<LayoutOption, cytoscape.LayoutOptions> = {
  auto: {
    name: 'cose',
    animate: false,
    nodeDimensionsIncludeLabels: true,
    idealEdgeLength: () => 120,
    nodeRepulsion: () => 8000,
    gravity: 0.25,
  } as cytoscape.LayoutOptions,
  hierarchical: {
    name: 'breadthfirst',
    animate: false,
    directed: true,
    spacingFactor: 1.5,
    nodeDimensionsIncludeLabels: true,
  } as cytoscape.LayoutOptions,
  force: {
    name: 'cose',
    animate: false,
    nodeDimensionsIncludeLabels: true,
    idealEdgeLength: () => 180,
    nodeRepulsion: () => 12000,
    gravity: 0.1,
    numIter: 500,
  } as cytoscape.LayoutOptions,
  circle: {
    name: 'circle',
    animate: false,
    nodeDimensionsIncludeLabels: true,
  } as cytoscape.LayoutOptions,
  grid: {
    name: 'grid',
    animate: false,
    nodeDimensionsIncludeLabels: true,
    condense: true,
  } as cytoscape.LayoutOptions,
};

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
 * Abbreviates an AWS resource type to a short label for node display.
 */
function abbreviateResourceType(resourceType: string): string {
  const abbreviations: Record<string, string> = {
    'AWS::EC2::Instance': 'EC2',
    'AWS::EC2::SecurityGroup': 'SG',
    'AWS::RDS::DBInstance': 'RDS',
    'AWS::RDS::DBCluster': 'RDS',
    'AWS::Lambda::Function': 'λ',
    'AWS::ECS::Service': 'ECS',
    'AWS::ECS::Cluster': 'ECS',
    'AWS::ElasticLoadBalancingV2::LoadBalancer': 'ALB',
    'AWS::DynamoDB::Table': 'DDB',
    'AWS::S3::Bucket': 'S3',
    'AWS::IAM::Role': 'IAM',
    'AWS::SNS::Topic': 'SNS',
    'AWS::SQS::Queue': 'SQS',
    'AWS::ApiGateway::RestApi': 'API',
    'AWS::EKS::Cluster': 'EKS',
    'AWS::Route53::HostedZone': 'R53',
    'AWS::CloudWatch::Alarm': 'CW',
    'AWS::Logs::LogGroup': 'Logs',
    'AWS::ElastiCache::CacheCluster': 'Cache',
    aws_instance: 'EC2',
    aws_security_group: 'SG',
    aws_db_instance: 'RDS',
    aws_rds_cluster: 'RDS',
    aws_lambda_function: 'λ',
    aws_ecs_service: 'ECS',
    aws_lb: 'ALB',
    aws_alb: 'ALB',
    aws_dynamodb_table: 'DDB',
    aws_s3_bucket: 'S3',
    aws_iam_role: 'IAM',
    aws_eks_cluster: 'EKS',
  };

  if (abbreviations[resourceType]) return abbreviations[resourceType];

  const parts = resourceType.split('::');
  if (parts.length >= 3) return parts[2].slice(0, 6);
  if (parts.length === 1 && resourceType.startsWith('aws_')) {
    return resourceType.replace('aws_', '').slice(0, 5).toUpperCase();
  }
  return resourceType.slice(0, 6);
}

/**
 * Interactive dependency graph visualization using Cytoscape.js.
 *
 * Supports zoom, pan, node selection, hover highlighting, animated edges,
 * dynamic node sizing, and multiple layout options.
 */
export function DependencyGraph({
  graph,
  scoredResources,
  onNodeSelect,
  className,
}: DependencyGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const animIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [selectedNode, setSelectedNode] = useState<SelectedNodeDetails | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedLayout, setSelectedLayout] = useState<LayoutOption>('auto');

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

      const cy = cyRef.current;
      if (cy && containerRef.current) {
        const renderedPos = event.target.renderedPosition();
        setPopoverPosition({ x: renderedPos.x, y: renderedPos.y });
      }

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
    setPopoverPosition(null);
    onNodeSelect?.(null);
  }, [onNodeSelect]);

  // Handle layout change
  const handleLayoutChange = useCallback((layout: LayoutOption) => {
    setSelectedLayout(layout);
    const cy = cyRef.current;
    if (cy) {
      cy.layout(LAYOUT_CONFIGS[layout]).run();
    }
  }, []);

  // Initialize and update Cytoscape instance
  useEffect(() => {
    if (!containerRef.current) return;

    const map = scoredMap.current;

    // Build Cytoscape elements
    const elements: cytoscape.ElementDefinition[] = [
      ...graph.nodes.map((node) => {
        const riskCategory = getRiskCategory(node, map);
        const scored = map.get(node.resourceId);
        const score = scored?.impactScore ?? (node.isDirectChange ? 100 : 0);
        const scoreLabel = scored?.impactScore ?? (node.isDirectChange ? '★' : '?');
        const typeAbbrev = abbreviateResourceType(node.resourceType);

        return {
          data: {
            id: node.resourceId,
            label: `${scoreLabel}\n${typeAbbrev}`,
            riskCategory,
            isDirectChange: node.isDirectChange,
            resourceType: node.resourceType,
            score: typeof score === 'number' ? score : 0,
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

    // Clear previous animation interval
    if (animIntervalRef.current) {
      clearInterval(animIntervalRef.current);
      animIntervalRef.current = null;
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
            // Dynamic node sizing based on score
            width: ((ele: cytoscape.NodeSingular) => {
              if (ele.data('isDirectChange')) return 50;
              const s = ele.data('score');
              return s ? 35 + (s / 100) * 35 : 30;
            }) as unknown as number,
            height: ((ele: cytoscape.NodeSingular) => {
              if (ele.data('isDirectChange')) return 50;
              const s = ele.data('score');
              return s ? 35 + (s / 100) * 35 : 30;
            }) as unknown as number,
            'background-color': ((ele: cytoscape.NodeSingular) => {
              const category = ele.data('riskCategory') as RiskCategory;
              return RISK_COLORS[category] || RISK_COLORS.Low;
            }) as unknown as string,
            'border-width': ((ele: cytoscape.NodeSingular) =>
              ele.data('isDirectChange') ? 4 : 2) as unknown as number,
            'border-color': ((ele: cytoscape.NodeSingular) =>
              ele.data('isDirectChange')
                ? DIRECT_CHANGE_BORDER
                : '#718096') as unknown as string,
            color: '#1a202c',
            'transition-property': 'opacity',
            'transition-duration': 150,
          } as cytoscape.Css.Node,
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
            'line-style': 'dashed',
            'line-dash-pattern': [6, 3],
            'line-dash-offset': 0,
            'transition-property': 'opacity',
            'transition-duration': 150,
          } as unknown as cytoscape.Css.Edge,
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
      layout: LAYOUT_CONFIGS[selectedLayout],
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      minZoom: 0.2,
      maxZoom: 5,
    });

    // Hover highlight: dim non-connected elements
    cy.on('mouseover', 'node', (event) => {
      const node = event.target;
      const neighborhood = node.closedNeighborhood();
      cy.elements().not(neighborhood).style('opacity', 0.15);
      neighborhood.style('opacity', 1);
    });
    cy.on('mouseout', 'node', () => {
      cy.elements().style('opacity', 1);
    });

    // Tap event listeners
    cy.on('tap', 'node', handleNodeTap);
    cy.on('tap', (event) => {
      if (event.target === cy) {
        handleBackgroundTap();
      }
    });

    // Animated edge flow (subtle dash movement)
    let dashOffset = 0;
    animIntervalRef.current = setInterval(() => {
      dashOffset = (dashOffset + 1) % 100;
      cy.edges().style('line-dash-offset', -dashOffset);
    }, 60);

    cyRef.current = cy;

    return () => {
      if (animIntervalRef.current) {
        clearInterval(animIntervalRef.current);
        animIntervalRef.current = null;
      }
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph, scoredResources, handleNodeTap, handleBackgroundTap, selectedLayout]);

  const layoutSelectStyle: React.CSSProperties = {
    padding: '0.25rem 0.5rem',
    fontSize: '0.75rem',
    background: 'var(--color-surface, #1e293b)',
    color: 'var(--color-text, #f1f5f9)',
    border: '1px solid var(--color-border, #334155)',
    borderRadius: '0.375rem',
    cursor: 'pointer',
    outline: 'none',
  };

  return (
    <div className={`dependency-graph-container ${className ?? ''}`} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted, #94a3b8)' }}>
          💡 Click a node for details • Scroll to zoom • Drag to pan • Hover to highlight
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted, #94a3b8)' }}>
            Layout:
          </label>
          <select
            value={selectedLayout}
            onChange={(e) => handleLayoutChange(e.target.value as LayoutOption)}
            style={layoutSelectStyle}
            aria-label="Graph layout"
          >
            <option value="auto">Auto</option>
            <option value="hierarchical">Hierarchical</option>
            <option value="force">Force</option>
            <option value="circle">Circle</option>
            <option value="grid">Grid</option>
          </select>
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <div
          ref={containerRef}
          className="dependency-graph-canvas"
          style={{ width: '100%', height: '600px', border: '1px solid var(--color-border, #334155)', borderRadius: '0.5rem', background: 'var(--color-surface, #1e293b)' }}
          role="img"
          aria-label="Dependency graph visualization showing resource relationships and risk levels"
        />
        <GraphLegend />
      </div>
      {selectedNode && popoverPosition && (
        <div
          className="dependency-graph-popover"
          role="region"
          aria-label="Selected resource details"
          style={{
            position: 'absolute',
            top: popoverPosition.y + 44, // offset for the header bar
            left: popoverPosition.x,
            transform: 'translate(-50%, -100%) translateY(-12px)',
            background: 'var(--color-bg, #0f172a)',
            border: `2px solid ${RISK_COLORS[selectedNode.riskCategory]}`,
            borderRadius: '0.5rem',
            padding: '1rem',
            minWidth: '280px',
            maxWidth: '380px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            zIndex: 1000,
            fontSize: '0.8125rem',
            color: 'var(--color-text, #f1f5f9)',
          }}
        >
          {/* Header with score badge */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontWeight: 600, color: RISK_COLORS[selectedNode.riskCategory], fontSize: '0.875rem' }}>
              {selectedNode.riskCategory}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{
                background: RISK_COLORS[selectedNode.riskCategory],
                color: '#fff',
                borderRadius: '9999px',
                padding: '0.125rem 0.625rem',
                fontWeight: 700,
                fontSize: '0.8125rem',
              }}>
                {selectedNode.impactScore}
              </span>
              <button
                onClick={() => { setSelectedNode(null); setPopoverPosition(null); onNodeSelect?.(null); }}
                aria-label="Close details"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-muted, #94a3b8)',
                  cursor: 'pointer',
                  fontSize: '1.125rem',
                  lineHeight: 1,
                  padding: '0 0.125rem',
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Resource info */}
          <div style={{ marginBottom: '0.5rem' }}>
            <div style={{ fontWeight: 600, wordBreak: 'break-all', marginBottom: '0.25rem' }}>
              {selectedNode.resourceType}
            </div>
            <div style={{ color: 'var(--color-text-muted, #94a3b8)', fontSize: '0.75rem', wordBreak: 'break-all' }}>
              {selectedNode.resourceId}
            </div>
          </div>

          {/* Metadata grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 1rem', fontSize: '0.75rem', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '0.75rem' }}>
            <span>Region: <strong style={{ color: 'var(--color-text, #f1f5f9)' }}>{selectedNode.region}</strong></span>
            <span>Account: <strong style={{ color: 'var(--color-text, #f1f5f9)' }}>{selectedNode.accountId}</strong></span>
            <span>Coverage: <strong style={{ color: 'var(--color-text, #f1f5f9)' }}>{selectedNode.dependencyCoverage}</strong></span>
            <span>Direct: <strong style={{ color: 'var(--color-text, #f1f5f9)' }}>{selectedNode.isDirectChange ? 'Yes' : 'No'}</strong></span>
          </div>

          {/* Dependency chain */}
          {selectedNode.dependencyChain.length > 1 && (
            <div style={{ borderTop: '1px solid var(--color-border, #334155)', paddingTop: '0.5rem' }}>
              <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '0.375rem' }}>
                Dependency Chain
              </div>
              <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono, monospace)', lineHeight: 1.6 }}>
                {selectedNode.dependencyChain.map((id, idx) => (
                  <span key={`${id}-${idx}`}>
                    <span style={{ color: idx === selectedNode.dependencyChain.length - 1 ? RISK_COLORS[selectedNode.riskCategory] : 'var(--color-text, #f1f5f9)' }}>
                      {id.length > 40 ? `...${id.slice(-35)}` : id}
                    </span>
                    {idx < selectedNode.dependencyChain.length - 1 && (
                      <span style={{ color: 'var(--color-text-muted, #94a3b8)', margin: '0 0.25rem' }}> → </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Close hint */}
          <div style={{ fontSize: '0.625rem', color: 'var(--color-text-muted, #94a3b8)', marginTop: '0.5rem', textAlign: 'center' }}>
            Click background to dismiss
          </div>
        </div>
      )}
    </div>
  );
}
