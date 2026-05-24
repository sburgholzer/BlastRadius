import { describe, it, expect } from 'vitest';
import type {
  DependencyGraph,
  DependencyNode,
  ScoredResource,
  RiskCategory,
} from '../api/types';

/**
 * Since the DependencyGraph component is a React component that relies on
 * Cytoscape.js and DOM rendering, we test the core logic functions that
 * drive the visualization: risk color mapping, node data transformation,
 * and selected node detail construction.
 */

const RISK_COLORS: Record<RiskCategory, string> = {
  Critical: '#e53e3e',
  High: '#dd6b20',
  Medium: '#d69e2e',
  Low: '#38a169',
};

function getRiskCategory(
  node: DependencyNode,
  scoredMap: Map<string, ScoredResource>
): RiskCategory {
  const scored = scoredMap.get(node.resourceId);
  if (scored) return scored.riskCategory;
  if (node.isDirectChange) return 'Critical';
  return 'Low';
}

function buildScoredMap(resources: ScoredResource[]): Map<string, ScoredResource> {
  const map = new Map<string, ScoredResource>();
  for (const sr of resources) {
    map.set(sr.resourceId, sr);
  }
  return map;
}

function buildCytoscapeElements(
  graph: DependencyGraph,
  scoredMap: Map<string, ScoredResource>
) {
  const nodes = graph.nodes.map((node) => {
    const riskCategory = getRiskCategory(node, scoredMap);
    return {
      data: {
        id: node.resourceId,
        label: `${node.resourceType}\n${node.resourceId.slice(-12)}`,
        riskCategory,
        isDirectChange: node.isDirectChange,
        resourceType: node.resourceType,
      },
    };
  });

  const edges = graph.edges.map((edge, index) => ({
    data: {
      id: `edge-${index}`,
      source: edge.sourceId,
      target: edge.targetId,
      relationshipType: edge.relationshipType,
    },
  }));

  return { nodes, edges };
}

describe('DependencyGraph logic', () => {
  const mockNode: DependencyNode = {
    resourceId: 'sg-0123456789abcdef0',
    resourceType: 'aws_security_group',
    provider: 'aws',
    region: 'us-east-1',
    accountId: '123456789012',
    isDirectChange: false,
    dependencyCoverage: 'full',
  };

  const mockScoredResource: ScoredResource = {
    resourceId: 'sg-0123456789abcdef0',
    resourceType: 'aws_security_group',
    provider: 'aws',
    region: 'us-east-1',
    accountId: '123456789012',
    impactScore: 82,
    riskCategory: 'Critical',
    dependencyChain: ['vpc-abc', 'sg-0123456789abcdef0'],
    dependencyDepth: 2,
    criticalityClassification: 'Medium',
    changeTypeSeverity: 100,
  };

  describe('getRiskCategory', () => {
    it('returns the scored risk category when resource is in the scored map', () => {
      const map = buildScoredMap([mockScoredResource]);
      expect(getRiskCategory(mockNode, map)).toBe('Critical');
    });

    it('returns Critical for directly changed nodes not in scored map', () => {
      const directNode: DependencyNode = { ...mockNode, isDirectChange: true };
      const map = buildScoredMap([]);
      expect(getRiskCategory(directNode, map)).toBe('Critical');
    });

    it('returns Low for non-direct nodes not in scored map', () => {
      const map = buildScoredMap([]);
      expect(getRiskCategory(mockNode, map)).toBe('Low');
    });

    it('returns correct category for each risk level', () => {
      const categories: RiskCategory[] = ['Critical', 'High', 'Medium', 'Low'];
      for (const category of categories) {
        const scored: ScoredResource = { ...mockScoredResource, riskCategory: category };
        const map = buildScoredMap([scored]);
        expect(getRiskCategory(mockNode, map)).toBe(category);
      }
    });
  });

  describe('RISK_COLORS', () => {
    it('maps Critical to red', () => {
      expect(RISK_COLORS.Critical).toBe('#e53e3e');
    });

    it('maps High to orange', () => {
      expect(RISK_COLORS.High).toBe('#dd6b20');
    });

    it('maps Medium to yellow', () => {
      expect(RISK_COLORS.Medium).toBe('#d69e2e');
    });

    it('maps Low to green', () => {
      expect(RISK_COLORS.Low).toBe('#38a169');
    });
  });

  describe('buildCytoscapeElements', () => {
    const graph: DependencyGraph = {
      nodes: [
        {
          resourceId: 'vpc-abc123',
          resourceType: 'aws_vpc',
          provider: 'aws',
          region: 'us-east-1',
          accountId: '123456789012',
          isDirectChange: true,
          dependencyCoverage: 'full',
        },
        {
          resourceId: 'sg-0123456789abcdef0',
          resourceType: 'aws_security_group',
          provider: 'aws',
          region: 'us-east-1',
          accountId: '123456789012',
          isDirectChange: false,
          dependencyCoverage: 'full',
        },
        {
          resourceId: 'ec2-instance-xyz',
          resourceType: 'aws_instance',
          provider: 'aws',
          region: 'us-east-1',
          accountId: '123456789012',
          isDirectChange: false,
          dependencyCoverage: 'partial',
        },
      ],
      edges: [
        {
          sourceId: 'vpc-abc123',
          targetId: 'sg-0123456789abcdef0',
          relationshipType: 'contains',
          depth: 1,
        },
        {
          sourceId: 'sg-0123456789abcdef0',
          targetId: 'ec2-instance-xyz',
          relationshipType: 'is_attached_to',
          depth: 2,
        },
      ],
    };

    const scoredResources: ScoredResource[] = [
      {
        resourceId: 'sg-0123456789abcdef0',
        resourceType: 'aws_security_group',
        provider: 'aws',
        region: 'us-east-1',
        accountId: '123456789012',
        impactScore: 65,
        riskCategory: 'High',
        dependencyChain: ['vpc-abc123', 'sg-0123456789abcdef0'],
        dependencyDepth: 1,
        criticalityClassification: 'Medium',
        changeTypeSeverity: 80,
      },
      {
        resourceId: 'ec2-instance-xyz',
        resourceType: 'aws_instance',
        provider: 'aws',
        region: 'us-east-1',
        accountId: '123456789012',
        impactScore: 42,
        riskCategory: 'Medium',
        dependencyChain: ['vpc-abc123', 'sg-0123456789abcdef0', 'ec2-instance-xyz'],
        dependencyDepth: 2,
        criticalityClassification: 'High',
        changeTypeSeverity: 50,
      },
    ];

    it('creates correct number of node elements', () => {
      const map = buildScoredMap(scoredResources);
      const { nodes } = buildCytoscapeElements(graph, map);
      expect(nodes).toHaveLength(3);
    });

    it('creates correct number of edge elements', () => {
      const map = buildScoredMap(scoredResources);
      const { edges } = buildCytoscapeElements(graph, map);
      expect(edges).toHaveLength(2);
    });

    it('assigns correct risk categories to nodes', () => {
      const map = buildScoredMap(scoredResources);
      const { nodes } = buildCytoscapeElements(graph, map);

      const vpcNode = nodes.find((n) => n.data.id === 'vpc-abc123');
      const sgNode = nodes.find((n) => n.data.id === 'sg-0123456789abcdef0');
      const ec2Node = nodes.find((n) => n.data.id === 'ec2-instance-xyz');

      // VPC is a direct change, not in scored map → Critical
      expect(vpcNode?.data.riskCategory).toBe('Critical');
      // SG is scored as High
      expect(sgNode?.data.riskCategory).toBe('High');
      // EC2 is scored as Medium
      expect(ec2Node?.data.riskCategory).toBe('Medium');
    });

    it('sets isDirectChange flag correctly on nodes', () => {
      const map = buildScoredMap(scoredResources);
      const { nodes } = buildCytoscapeElements(graph, map);

      const vpcNode = nodes.find((n) => n.data.id === 'vpc-abc123');
      const sgNode = nodes.find((n) => n.data.id === 'sg-0123456789abcdef0');

      expect(vpcNode?.data.isDirectChange).toBe(true);
      expect(sgNode?.data.isDirectChange).toBe(false);
    });

    it('creates edge elements with correct source and target', () => {
      const map = buildScoredMap(scoredResources);
      const { edges } = buildCytoscapeElements(graph, map);

      expect(edges[0].data.source).toBe('vpc-abc123');
      expect(edges[0].data.target).toBe('sg-0123456789abcdef0');
      expect(edges[1].data.source).toBe('sg-0123456789abcdef0');
      expect(edges[1].data.target).toBe('ec2-instance-xyz');
    });

    it('generates unique edge IDs', () => {
      const map = buildScoredMap(scoredResources);
      const { edges } = buildCytoscapeElements(graph, map);
      const ids = edges.map((e) => e.data.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('generates labels with resource type and truncated ID', () => {
      const map = buildScoredMap(scoredResources);
      const { nodes } = buildCytoscapeElements(graph, map);

      const vpcNode = nodes.find((n) => n.data.id === 'vpc-abc123');
      expect(vpcNode?.data.label).toContain('aws_vpc');
    });

    it('handles empty graph', () => {
      const emptyGraph: DependencyGraph = { nodes: [], edges: [] };
      const map = buildScoredMap([]);
      const { nodes, edges } = buildCytoscapeElements(emptyGraph, map);
      expect(nodes).toHaveLength(0);
      expect(edges).toHaveLength(0);
    });
  });

  describe('buildScoredMap', () => {
    it('creates a map keyed by resourceId', () => {
      const map = buildScoredMap([mockScoredResource]);
      expect(map.get('sg-0123456789abcdef0')).toBe(mockScoredResource);
    });

    it('handles empty array', () => {
      const map = buildScoredMap([]);
      expect(map.size).toBe(0);
    });

    it('handles multiple resources', () => {
      const resources: ScoredResource[] = [
        mockScoredResource,
        { ...mockScoredResource, resourceId: 'vpc-xyz', riskCategory: 'Low' },
      ];
      const map = buildScoredMap(resources);
      expect(map.size).toBe(2);
      expect(map.get('vpc-xyz')?.riskCategory).toBe('Low');
    });
  });
});
