import { describe, it, expect } from 'vitest';
import { buildJsonExport, buildPdfContent } from './ExportPanel';
import type { ScoredResource, DependencyGraph, RiskCategory } from '../api/types';
import type { GraphFilterState } from './GraphFilters';

function makeScoredResource(overrides: Partial<ScoredResource> = {}): ScoredResource {
  return {
    resourceId: 'res-1',
    resourceType: 'AWS::EC2::Instance',
    provider: 'aws',
    region: 'us-east-1',
    accountId: '123456789012',
    impactScore: 85,
    riskCategory: 'Critical',
    dependencyChain: ['sg-root', 'res-1'],
    dependencyDepth: 1,
    criticalityClassification: 'High',
    changeTypeSeverity: 100,
    ...overrides,
  };
}

describe('buildJsonExport', () => {
  it('includes all required fields for each resource', () => {
    const resources: ScoredResource[] = [
      makeScoredResource({
        resourceId: 'sg-001',
        resourceType: 'AWS::EC2::SecurityGroup',
        impactScore: 92,
        riskCategory: 'Critical',
        dependencyChain: ['root-change', 'sg-001'],
      }),
      makeScoredResource({
        resourceId: 'i-001',
        resourceType: 'AWS::EC2::Instance',
        impactScore: 65,
        riskCategory: 'High',
        dependencyChain: ['root-change', 'sg-001', 'i-001'],
      }),
    ];

    const result = buildJsonExport(resources, 'analysis-123');

    expect(result.resources).toHaveLength(2);
    for (const entry of result.resources) {
      expect(entry).toHaveProperty('resourceType');
      expect(entry).toHaveProperty('resourceId');
      expect(entry).toHaveProperty('impactScore');
      expect(entry).toHaveProperty('riskCategory');
      expect(entry).toHaveProperty('dependencyChain');
    }
  });

  it('preserves resource type correctly', () => {
    const resources = [
      makeScoredResource({ resourceType: 'AWS::Lambda::Function' }),
    ];
    const result = buildJsonExport(resources, 'analysis-456');
    expect(result.resources[0].resourceType).toBe('AWS::Lambda::Function');
  });

  it('preserves resource ID correctly', () => {
    const resources = [makeScoredResource({ resourceId: 'lambda-abc-123' })];
    const result = buildJsonExport(resources, 'analysis-456');
    expect(result.resources[0].resourceId).toBe('lambda-abc-123');
  });

  it('preserves Impact_Score correctly', () => {
    const resources = [makeScoredResource({ impactScore: 77 })];
    const result = buildJsonExport(resources, 'analysis-456');
    expect(result.resources[0].impactScore).toBe(77);
  });

  it('preserves risk category correctly', () => {
    const resources = [makeScoredResource({ riskCategory: 'Medium' })];
    const result = buildJsonExport(resources, 'analysis-456');
    expect(result.resources[0].riskCategory).toBe('Medium');
  });

  it('preserves dependency chain correctly', () => {
    const chain = ['root', 'mid-1', 'mid-2', 'target'];
    const resources = [makeScoredResource({ dependencyChain: chain })];
    const result = buildJsonExport(resources, 'analysis-456');
    expect(result.resources[0].dependencyChain).toEqual(chain);
  });

  it('includes analysis ID in export metadata', () => {
    const result = buildJsonExport([], 'my-analysis-id');
    expect(result.analysisId).toBe('my-analysis-id');
  });

  it('includes export timestamp', () => {
    const before = new Date().toISOString();
    const result = buildJsonExport([], 'analysis-1');
    const after = new Date().toISOString();
    expect(result.exportedAt >= before).toBe(true);
    expect(result.exportedAt <= after).toBe(true);
  });

  it('includes applied filters in export', () => {
    const filters: GraphFilterState = {
      riskCategories: new Set<RiskCategory>(['Critical', 'High']),
      resourceTypes: new Set(['AWS::EC2::Instance']),
      sourceTools: new Set(['aws']),
    };
    const result = buildJsonExport([], 'analysis-1', filters);
    expect(result.filters.riskCategories).toContain('Critical');
    expect(result.filters.riskCategories).toContain('High');
    expect(result.filters.resourceTypes).toContain('AWS::EC2::Instance');
    expect(result.filters.sourceTools).toContain('aws');
  });

  it('includes empty filter arrays when no filters applied', () => {
    const result = buildJsonExport([], 'analysis-1');
    expect(result.filters.riskCategories).toEqual([]);
    expect(result.filters.resourceTypes).toEqual([]);
    expect(result.filters.sourceTools).toEqual([]);
  });

  it('includes dependency graph structure when provided', () => {
    const graph: DependencyGraph = {
      nodes: [
        {
          resourceId: 'sg-001',
          resourceType: 'AWS::EC2::SecurityGroup',
          provider: 'aws',
          region: 'us-east-1',
          accountId: '123456789012',
          isDirectChange: true,
          dependencyCoverage: 'full',
        },
        {
          resourceId: 'i-001',
          resourceType: 'AWS::EC2::Instance',
          provider: 'aws',
          region: 'us-east-1',
          accountId: '123456789012',
          isDirectChange: false,
          dependencyCoverage: 'full',
        },
      ],
      edges: [
        {
          sourceId: 'sg-001',
          targetId: 'i-001',
          relationshipType: 'is_attached_to',
          depth: 1,
        },
      ],
    };

    const result = buildJsonExport([], 'analysis-1', undefined, graph);
    expect(result.dependencyGraph).toBeDefined();
    expect(result.dependencyGraph!.nodes).toHaveLength(2);
    expect(result.dependencyGraph!.edges).toHaveLength(1);
    expect(result.dependencyGraph!.edges[0].sourceId).toBe('sg-001');
    expect(result.dependencyGraph!.edges[0].targetId).toBe('i-001');
  });

  it('omits dependency graph when not provided', () => {
    const result = buildJsonExport([], 'analysis-1');
    expect(result.dependencyGraph).toBeUndefined();
  });

  it('reports correct total resource count', () => {
    const resources = [
      makeScoredResource({ resourceId: 'a' }),
      makeScoredResource({ resourceId: 'b' }),
      makeScoredResource({ resourceId: 'c' }),
    ];
    const result = buildJsonExport(resources, 'analysis-1');
    expect(result.totalResources).toBe(3);
  });

  it('handles empty resource list', () => {
    const result = buildJsonExport([], 'analysis-1');
    expect(result.resources).toEqual([]);
    expect(result.totalResources).toBe(0);
  });
});

describe('buildPdfContent', () => {
  it('includes analysis ID in output', () => {
    const content = buildPdfContent([], 'analysis-pdf-1');
    expect(content).toContain('analysis-pdf-1');
  });

  it('includes resource details for each resource', () => {
    const resources = [
      makeScoredResource({
        resourceId: 'rds-001',
        resourceType: 'AWS::RDS::DBInstance',
        impactScore: 95,
        riskCategory: 'Critical',
        dependencyChain: ['root', 'rds-001'],
      }),
    ];
    const content = buildPdfContent(resources, 'analysis-1');
    expect(content).toContain('rds-001');
    expect(content).toContain('AWS::RDS::DBInstance');
    expect(content).toContain('95');
    expect(content).toContain('Critical');
    expect(content).toContain('root → rds-001');
  });

  it('includes applied filters in output', () => {
    const filters: GraphFilterState = {
      riskCategories: new Set<RiskCategory>(['High']),
      resourceTypes: new Set(['AWS::Lambda::Function']),
      sourceTools: new Set(['terraform']),
    };
    const content = buildPdfContent([], 'analysis-1', filters);
    expect(content).toContain('High');
    expect(content).toContain('AWS::Lambda::Function');
    expect(content).toContain('terraform');
  });

  it('includes dependency graph summary when provided', () => {
    const graph: DependencyGraph = {
      nodes: [
        {
          resourceId: 'n1',
          resourceType: 'AWS::EC2::Instance',
          provider: 'aws',
          region: 'us-east-1',
          accountId: '123',
          isDirectChange: true,
          dependencyCoverage: 'full',
        },
      ],
      edges: [],
    };
    const content = buildPdfContent([], 'analysis-1', undefined, graph);
    expect(content).toContain('Dependency Graph');
    expect(content).toContain('Nodes: 1');
    expect(content).toContain('Edges: 0');
  });
});
