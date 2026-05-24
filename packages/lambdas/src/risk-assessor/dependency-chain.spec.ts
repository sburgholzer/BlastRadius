/**
 * Property-based tests for critical resource dependency chains.
 *
 * Feature: blast-radius-visualizer, Property 11: Critical Resources Include Dependency Chain
 *
 * **Validates: Requirements 4.4**
 *
 * For any resource classified as Critical (score 75-100), the Risk Assessor output
 * SHALL include a valid dependency chain — an ordered list of resource identifiers
 * from the changed resource to the affected resource, where each consecutive pair
 * has a direct dependency edge.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { handler, type AssessorInput } from './handler';
import type {
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  ResourceChangeManifest,
  ModificationType,
} from '@blast-radius/core';

// --- Generators ---

/**
 * Generates a graph scenario that produces a Critical resource:
 * - A directly changed source resource with modification type Remove (severity 100)
 * - A target resource of type AWS::RDS::DBInstance (criticality Critical = 100) at depth 1
 *
 * With depth 1, Remove, and Critical criticality:
 *   depthScore = max(10, 100 - ((1-1)*10)) = 100
 *   criticalityScore = 100
 *   changeTypeSeverity = 100
 *   Impact_Score = round((100*0.30) + (100*0.40) + (100*0.30)) = 100 → Critical
 *
 * Additional intermediate nodes may be added to make the graph more realistic,
 * but the target is always at depth 1 from the source.
 */
const arbitraryCriticalResourceGraph = fc
  .record({
    sourceId: fc.string({ minLength: 3, maxLength: 12 }).map((s) => `src-${s.replace(/[^a-zA-Z0-9]/g, 'x')}`),
    targetId: fc.string({ minLength: 3, maxLength: 12 }).map((s) => `tgt-${s.replace(/[^a-zA-Z0-9]/g, 'x')}`),
    extraNodeCount: fc.integer({ min: 0, max: 3 }),
    sourceResourceType: fc.constantFrom(
      'AWS::EC2::Instance',
      'AWS::Lambda::Function',
      'AWS::S3::Bucket',
      'AWS::SNS::Topic',
    ),
  })
  .filter(({ sourceId, targetId }) => sourceId !== targetId)
  .map(({ sourceId, targetId, extraNodeCount, sourceResourceType }) => {
    const nodes: DependencyNode[] = [];
    const edges: DependencyEdge[] = [];

    // Source node (directly changed)
    nodes.push({
      resourceId: sourceId,
      resourceType: sourceResourceType,
      provider: 'aws',
      region: 'us-east-1',
      accountId: '123456789012',
      isDirectChange: true,
      dependencyCoverage: 'full',
    });

    // Target node (AWS::RDS::DBInstance → Critical criticality)
    nodes.push({
      resourceId: targetId,
      resourceType: 'AWS::RDS::DBInstance',
      provider: 'aws',
      region: 'us-east-1',
      accountId: '123456789012',
      isDirectChange: false,
      dependencyCoverage: 'full',
    });

    // Direct edge from source to target at depth 1
    edges.push({
      sourceId: sourceId,
      targetId: targetId,
      relationshipType: 'references',
      depth: 1,
    });

    // Add extra unrelated nodes to make the graph more realistic
    for (let i = 0; i < extraNodeCount; i++) {
      const extraId = `extra-${i}-${sourceId}`;
      nodes.push({
        resourceId: extraId,
        resourceType: 'AWS::CloudWatch::Alarm',
        provider: 'aws',
        region: 'us-east-1',
        accountId: '123456789012',
        isDirectChange: false,
        dependencyCoverage: 'full',
      });
      edges.push({
        sourceId: sourceId,
        targetId: extraId,
        relationshipType: 'references',
        depth: 1,
      });
    }

    const manifest: ResourceChangeManifest = {
      version: '1.0',
      metadata: {
        submittedAt: new Date().toISOString(),
        sourceFormat: 'canonical',
      },
      resources: [
        {
          resourceId: sourceId,
          resourceType: sourceResourceType,
          provider: 'aws',
          modificationType: 'Remove' as ModificationType,
          region: 'us-east-1',
          accountId: '123456789012',
        },
      ],
    };

    const dependencyGraph: DependencyGraph = { nodes, edges };

    return { sourceId, targetId, dependencyGraph, manifest };
  });

// --- Property Tests ---

describe('Feature: blast-radius-visualizer, Property 11: Critical Resources Include Dependency Chain', () => {
  /**
   * **Validates: Requirements 4.4**
   *
   * For any resource classified as Critical, the dependencyChain must be non-empty.
   */
  it('should include a non-empty dependencyChain for Critical resources', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryCriticalResourceGraph, async ({ sourceId, targetId, dependencyGraph, manifest }) => {
        const input: AssessorInput = { dependencyGraph, manifest };
        const result = await handler(input);

        const targetScored = result.scoredResources.find((r) => r.resourceId === targetId);

        expect(targetScored).toBeDefined();
        expect(targetScored!.riskCategory).toBe('Critical');
        expect(targetScored!.dependencyChain).toBeDefined();
        expect(targetScored!.dependencyChain.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * The first element of the dependency chain must be the directly changed resource.
   */
  it('should have the direct change as the first element of the dependency chain', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryCriticalResourceGraph, async ({ sourceId, targetId, dependencyGraph, manifest }) => {
        const input: AssessorInput = { dependencyGraph, manifest };
        const result = await handler(input);

        const targetScored = result.scoredResources.find((r) => r.resourceId === targetId);

        expect(targetScored).toBeDefined();
        expect(targetScored!.riskCategory).toBe('Critical');
        expect(targetScored!.dependencyChain[0]).toBe(sourceId);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * The last element of the dependency chain must be the scored (affected) resource.
   */
  it('should have the scored resource as the last element of the dependency chain', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryCriticalResourceGraph, async ({ sourceId, targetId, dependencyGraph, manifest }) => {
        const input: AssessorInput = { dependencyGraph, manifest };
        const result = await handler(input);

        const targetScored = result.scoredResources.find((r) => r.resourceId === targetId);

        expect(targetScored).toBeDefined();
        expect(targetScored!.riskCategory).toBe('Critical');
        const chain = targetScored!.dependencyChain;
        expect(chain[chain.length - 1]).toBe(targetId);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * Each consecutive pair in the dependency chain must have a direct dependency edge
   * in the graph.
   */
  it('should have a valid edge between each consecutive pair in the dependency chain', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryCriticalResourceGraph, async ({ sourceId, targetId, dependencyGraph, manifest }) => {
        const input: AssessorInput = { dependencyGraph, manifest };
        const result = await handler(input);

        const targetScored = result.scoredResources.find((r) => r.resourceId === targetId);

        expect(targetScored).toBeDefined();
        expect(targetScored!.riskCategory).toBe('Critical');

        const chain = targetScored!.dependencyChain;

        // Each consecutive pair must have a corresponding edge in the graph
        for (let i = 0; i < chain.length - 1; i++) {
          const from = chain[i];
          const to = chain[i + 1];
          const hasEdge = dependencyGraph.edges.some(
            (e) => e.sourceId === from && e.targetId === to,
          );
          expect(hasEdge).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
