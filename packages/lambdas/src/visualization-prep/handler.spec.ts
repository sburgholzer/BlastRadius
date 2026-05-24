/**
 * Unit tests for the Visualization Prep Lambda handler.
 *
 * Validates: Requirements 5.6, 6.1
 *
 * Tests that the handler correctly transforms scored dependency graphs
 * into visualization-ready node/edge lists with layout hints and stores
 * results in S3.
 */

import { describe, it, expect, vi } from 'vitest';
import { handler } from './handler';
import type { VisualizationPrepInput, VisualizationPrepDeps, VisualizationPrepOutput } from './handler';
import type { DependencyGraph, ScoredResource, RiskSummary } from '@blast-radius/core';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

/** Create a mock S3 client that captures PutObject calls. */
function createMockS3Client() {
  const putCalls: { Bucket: string; Key: string; Body: string; ContentType: string }[] = [];
  const s3Client = {
    send: vi.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        const input = (command as PutObjectCommand).input;
        putCalls.push({
          Bucket: input.Bucket!,
          Key: input.Key!,
          Body: input.Body as string,
          ContentType: input.ContentType!,
        });
      }
      return {};
    }),
  } as unknown as S3Client;

  return { s3Client, putCalls };
}

function createTestGraph(): DependencyGraph {
  return {
    nodes: [
      {
        resourceId: 'sg-123',
        resourceType: 'aws_security_group',
        provider: 'aws',
        region: 'us-east-1',
        accountId: '111111111111',
        isDirectChange: true,
        dependencyCoverage: 'full',
      },
      {
        resourceId: 'ec2-456',
        resourceType: 'aws_instance',
        provider: 'aws',
        region: 'us-east-1',
        accountId: '111111111111',
        isDirectChange: false,
        dependencyCoverage: 'full',
      },
      {
        resourceId: 'rds-789',
        resourceType: 'aws_db_instance',
        provider: 'aws',
        region: 'us-west-2',
        accountId: '222222222222',
        isDirectChange: false,
        dependencyCoverage: 'partial',
      },
    ],
    edges: [
      {
        sourceId: 'sg-123',
        targetId: 'ec2-456',
        relationshipType: 'is_attached_to',
        depth: 1,
      },
      {
        sourceId: 'ec2-456',
        targetId: 'rds-789',
        relationshipType: 'references',
        depth: 2,
      },
    ],
  };
}

function createTestScoredResources(): ScoredResource[] {
  return [
    {
      resourceId: 'ec2-456',
      resourceType: 'aws_instance',
      provider: 'aws',
      region: 'us-east-1',
      accountId: '111111111111',
      impactScore: 80,
      riskCategory: 'Critical',
      dependencyChain: ['sg-123', 'ec2-456'],
      dependencyDepth: 1,
      criticalityClassification: 'High',
      changeTypeSeverity: 100,
      highestRiskPath: [{ sourceId: 'sg-123', targetId: 'ec2-456', relationshipType: 'is_attached_to', depth: 1 }],
    },
    {
      resourceId: 'rds-789',
      resourceType: 'aws_db_instance',
      provider: 'aws',
      region: 'us-west-2',
      accountId: '222222222222',
      impactScore: 65,
      riskCategory: 'High',
      dependencyChain: ['sg-123', 'ec2-456', 'rds-789'],
      dependencyDepth: 2,
      criticalityClassification: 'Critical',
      changeTypeSeverity: 100,
      highestRiskPath: [
        { sourceId: 'sg-123', targetId: 'ec2-456', relationshipType: 'is_attached_to', depth: 1 },
        { sourceId: 'ec2-456', targetId: 'rds-789', relationshipType: 'references', depth: 2 },
      ],
    },
  ];
}

function createTestRiskSummary(): RiskSummary {
  return {
    critical: 1,
    high: 1,
    medium: 0,
    low: 0,
    totalAffected: 2,
    highestScore: 80,
  };
}

describe('Visualization Prep Lambda handler', () => {
  it('should transform a scored dependency graph into visualization-ready format and store in S3', async () => {
    const { s3Client, putCalls } = createMockS3Client();
    const deps: VisualizationPrepDeps = { s3Client };

    const input: VisualizationPrepInput = {
      analysisId: 'analysis-001',
      dependencyGraph: createTestGraph(),
      scoredResources: createTestScoredResources(),
      riskSummary: createTestRiskSummary(),
    };

    const result = await handler(input, deps);

    // Should succeed
    expect(result).not.toHaveProperty('error');
    const output = result as VisualizationPrepOutput;
    expect(output.analysisId).toBe('analysis-001');
    expect(output.s3Key).toBe('analyses/analysis-001/visualization.json');
    expect(output.totalNodes).toBe(3);
    expect(output.totalEdges).toBe(2);

    // Should have stored in S3
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].Bucket).toBe('blast-radius-results');
    expect(putCalls[0].Key).toBe('analyses/analysis-001/visualization.json');
    expect(putCalls[0].ContentType).toBe('application/json');

    // Verify stored content
    const stored = JSON.parse(putCalls[0].Body);
    expect(stored.analysisId).toBe('analysis-001');
    expect(stored.nodes).toHaveLength(3);
    expect(stored.edges).toHaveLength(2);
    expect(stored.riskSummary).toEqual(createTestRiskSummary());
    expect(stored.metadata.totalNodes).toBe(3);
    expect(stored.metadata.totalEdges).toBe(2);
    expect(stored.metadata.directChanges).toBe(1);
    expect(stored.metadata.affectedResources).toBe(2);
  });

  it('should assign correct colors based on risk category', async () => {
    const { s3Client, putCalls } = createMockS3Client();
    const deps: VisualizationPrepDeps = { s3Client };

    const input: VisualizationPrepInput = {
      analysisId: 'analysis-002',
      dependencyGraph: createTestGraph(),
      scoredResources: createTestScoredResources(),
      riskSummary: createTestRiskSummary(),
    };

    await handler(input, deps);

    const stored = JSON.parse(putCalls[0].Body);

    // Direct change node should be blue
    const directNode = stored.nodes.find((n: { id: string }) => n.id === 'sg-123');
    expect(directNode.color).toBe('#2563eb');
    expect(directNode.isDirectChange).toBe(true);

    // Critical risk node should be red
    const criticalNode = stored.nodes.find((n: { id: string }) => n.id === 'ec2-456');
    expect(criticalNode.color).toBe('#dc2626');

    // High risk node should be orange
    const highNode = stored.nodes.find((n: { id: string }) => n.id === 'rds-789');
    expect(highNode.color).toBe('#ea580c');
  });

  it('should compute edge thickness based on depth', async () => {
    const { s3Client, putCalls } = createMockS3Client();
    const deps: VisualizationPrepDeps = { s3Client };

    const input: VisualizationPrepInput = {
      analysisId: 'analysis-003',
      dependencyGraph: createTestGraph(),
      scoredResources: createTestScoredResources(),
      riskSummary: createTestRiskSummary(),
    };

    await handler(input, deps);

    const stored = JSON.parse(putCalls[0].Body);

    // Depth 1 edge should be thicker than depth 2 edge
    const depth1Edge = stored.edges.find((e: { depth: number }) => e.depth === 1);
    const depth2Edge = stored.edges.find((e: { depth: number }) => e.depth === 2);
    expect(depth1Edge.thickness).toBeGreaterThan(depth2Edge.thickness);
  });

  it('should use hierarchical layout for acyclic graphs', async () => {
    const { s3Client, putCalls } = createMockS3Client();
    const deps: VisualizationPrepDeps = { s3Client };

    const input: VisualizationPrepInput = {
      analysisId: 'analysis-004',
      dependencyGraph: createTestGraph(),
      scoredResources: createTestScoredResources(),
      riskSummary: createTestRiskSummary(),
    };

    await handler(input, deps);

    const stored = JSON.parse(putCalls[0].Body);
    expect(stored.layout.algorithm).toBe('hierarchical');
  });

  it('should use force-directed layout for cyclic graphs', async () => {
    const { s3Client, putCalls } = createMockS3Client();
    const deps: VisualizationPrepDeps = { s3Client };

    const cyclicGraph: DependencyGraph = {
      nodes: [
        { resourceId: 'a', resourceType: 'aws_instance', provider: 'aws', region: 'us-east-1', accountId: '111', isDirectChange: true, dependencyCoverage: 'full' },
        { resourceId: 'b', resourceType: 'aws_instance', provider: 'aws', region: 'us-east-1', accountId: '111', isDirectChange: false, dependencyCoverage: 'full' },
        { resourceId: 'c', resourceType: 'aws_instance', provider: 'aws', region: 'us-east-1', accountId: '111', isDirectChange: false, dependencyCoverage: 'full' },
      ],
      edges: [
        { sourceId: 'a', targetId: 'b', relationshipType: 'references', depth: 1 },
        { sourceId: 'b', targetId: 'c', relationshipType: 'references', depth: 2 },
        { sourceId: 'c', targetId: 'a', relationshipType: 'references', depth: 3 }, // cycle
      ],
    };

    const input: VisualizationPrepInput = {
      analysisId: 'analysis-005',
      dependencyGraph: cyclicGraph,
      scoredResources: [],
      riskSummary: { critical: 0, high: 0, medium: 0, low: 0, totalAffected: 0, highestScore: 0 },
    };

    await handler(input, deps);

    const stored = JSON.parse(putCalls[0].Body);
    expect(stored.layout.algorithm).toBe('force-directed');
  });

  it('should group nodes by account/region', async () => {
    const { s3Client, putCalls } = createMockS3Client();
    const deps: VisualizationPrepDeps = { s3Client };

    const input: VisualizationPrepInput = {
      analysisId: 'analysis-006',
      dependencyGraph: createTestGraph(),
      scoredResources: createTestScoredResources(),
      riskSummary: createTestRiskSummary(),
    };

    await handler(input, deps);

    const stored = JSON.parse(putCalls[0].Body);

    // Should have 2 groups: 111111111111/us-east-1 and 222222222222/us-west-2
    expect(stored.layout.groups).toHaveLength(2);

    const group1 = stored.layout.groups.find((g: { id: string }) => g.id === '111111111111/us-east-1');
    expect(group1).toBeDefined();
    expect(group1.nodeIds).toContain('sg-123');
    expect(group1.nodeIds).toContain('ec2-456');

    const group2 = stored.layout.groups.find((g: { id: string }) => g.id === '222222222222/us-west-2');
    expect(group2).toBeDefined();
    expect(group2.nodeIds).toContain('rds-789');
  });

  it('should return error for invalid input', async () => {
    const { s3Client } = createMockS3Client();
    const deps: VisualizationPrepDeps = { s3Client };

    const result = await handler({ analysisId: '', dependencyGraph: { nodes: [], edges: [] }, scoredResources: [], riskSummary: {} as RiskSummary }, deps);
    expect(result).toHaveProperty('error');
    expect(result).toHaveProperty('statusCode', 400);
  });

  it('should return error when S3 put fails', async () => {
    const s3Client = {
      send: vi.fn(async () => {
        throw new Error('S3 access denied');
      }),
    } as unknown as S3Client;
    const deps: VisualizationPrepDeps = { s3Client };

    const input: VisualizationPrepInput = {
      analysisId: 'analysis-007',
      dependencyGraph: createTestGraph(),
      scoredResources: createTestScoredResources(),
      riskSummary: createTestRiskSummary(),
    };

    const result = await handler(input, deps);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('S3 access denied');
    expect(result).toHaveProperty('statusCode', 500);
  });

  it('should handle empty graph gracefully', async () => {
    const { s3Client, putCalls } = createMockS3Client();
    const deps: VisualizationPrepDeps = { s3Client };

    const input: VisualizationPrepInput = {
      analysisId: 'analysis-008',
      dependencyGraph: { nodes: [], edges: [] },
      scoredResources: [],
      riskSummary: { critical: 0, high: 0, medium: 0, low: 0, totalAffected: 0, highestScore: 0 },
    };

    const result = await handler(input, deps);

    expect(result).not.toHaveProperty('error');
    const output = result as VisualizationPrepOutput;
    expect(output.totalNodes).toBe(0);
    expect(output.totalEdges).toBe(0);

    const stored = JSON.parse(putCalls[0].Body);
    expect(stored.nodes).toHaveLength(0);
    expect(stored.edges).toHaveLength(0);
    expect(stored.layout.algorithm).toBe('hierarchical');
  });
});
