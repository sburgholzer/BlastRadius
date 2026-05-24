/**
 * Property-based tests for multi-path scoring.
 *
 * Feature: blast-radius-visualizer, Property 10: Multi-Path Scoring Uses Maximum
 *
 * Validates: Requirements 4.6
 *
 * For any resource reachable via multiple dependency paths from changed resources,
 * the Risk Assessor SHALL assign the Impact_Score corresponding to the highest-scoring path.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  handler,
  computeDepthScore,
  computeImpactScore,
  type AssessorInput,
} from './handler';
import type {
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  ResourceChangeManifest,
  ModificationType,
  CriticalityClassification,
} from '@blast-radius/core';
import { createCriticalityConfig } from '@blast-radius/core';

// --- Constants ---

const CRITICALITY_SCORES: Record<CriticalityClassification, number> = {
  Critical: 100,
  High: 75,
  Medium: 50,
  Low: 25,
};

const CHANGE_TYPE_SEVERITY: Record<ModificationType, number> = {
  Remove: 100,
  Replace: 80,
  Modify: 50,
  Add: 30,
};

// Resource types mapped to known criticality levels for deterministic testing
const RESOURCE_TYPES_BY_CRITICALITY: Record<CriticalityClassification, string> = {
  Critical: 'AWS::RDS::DBInstance',
  High: 'AWS::Lambda::Function',
  Medium: 'AWS::S3::Bucket',
  Low: 'AWS::CloudWatch::Alarm',
};

// --- Generators ---

/** Generates a modification type. */
const arbitraryModificationType = fc.constantFrom<ModificationType>('Remove', 'Replace', 'Modify', 'Add');

/** Generates a criticality classification. */
const arbitraryCriticality = fc.constantFrom<CriticalityClassification>('Critical', 'High', 'Medium', 'Low');

/** Generates a depth between 1 and 9 (to allow room for multi-hop paths). */
const arbitraryDepth = fc.integer({ min: 1, max: 5 });

/**
 * Generates a multi-path graph scenario where a target resource is reachable
 * from multiple source (directly changed) resources via different paths.
 *
 * Structure:
 * - 2-4 source resources (directly changed) with different modification types
 * - 1 target resource reachable from all sources at different depths
 * - Intermediate nodes connecting sources to target
 */
const arbitraryMultiPathScenario = fc.record({
  numSources: fc.integer({ min: 2, max: 4 }),
  sourceModTypes: fc.array(arbitraryModificationType, { minLength: 4, maxLength: 4 }),
  pathDepths: fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 4, maxLength: 4 }),
  targetCriticality: arbitraryCriticality,
}).map(({ numSources, sourceModTypes, pathDepths, targetCriticality }) => {
  const targetId = 'target-resource';
  const targetResourceType = RESOURCE_TYPES_BY_CRITICALITY[targetCriticality];

  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  const manifestResources: { resourceId: string; resourceType: string; provider: string; modificationType: ModificationType; region: string; accountId: string }[] = [];

  // Create target node
  nodes.push({
    resourceId: targetId,
    resourceType: targetResourceType,
    provider: 'aws',
    region: 'us-east-1',
    accountId: '123456789012',
    isDirectChange: false,
    dependencyCoverage: 'full',
  });

  // Create source nodes and paths to target
  for (let i = 0; i < numSources; i++) {
    const sourceId = `source-${i}`;
    const modType = sourceModTypes[i];
    const depth = pathDepths[i];

    // Add source node
    nodes.push({
      resourceId: sourceId,
      resourceType: 'AWS::EC2::Instance',
      provider: 'aws',
      region: 'us-east-1',
      accountId: '123456789012',
      isDirectChange: true,
      dependencyCoverage: 'full',
    });

    // Add manifest resource
    manifestResources.push({
      resourceId: sourceId,
      resourceType: 'AWS::EC2::Instance',
      provider: 'aws',
      modificationType: modType,
      region: 'us-east-1',
      accountId: '123456789012',
    });

    // Create intermediate nodes and edges for this path
    let prevNodeId = sourceId;
    for (let d = 1; d < depth; d++) {
      const intermediateId = `intermediate-${i}-${d}`;
      nodes.push({
        resourceId: intermediateId,
        resourceType: 'AWS::SNS::Topic',
        provider: 'aws',
        region: 'us-east-1',
        accountId: '123456789012',
        isDirectChange: false,
        dependencyCoverage: 'full',
      });
      edges.push({
        sourceId: prevNodeId,
        targetId: intermediateId,
        relationshipType: 'references',
        depth: d,
      });
      prevNodeId = intermediateId;
    }

    // Final edge to target
    edges.push({
      sourceId: prevNodeId,
      targetId: targetId,
      relationshipType: 'references',
      depth: depth,
    });
  }

  return {
    numSources,
    sourceModTypes: sourceModTypes.slice(0, numSources),
    pathDepths: pathDepths.slice(0, numSources),
    targetCriticality,
    targetId,
    targetResourceType,
    nodes,
    edges,
    manifestResources,
  };
});

// --- Helper Functions ---

/**
 * Manually compute the expected maximum score across all paths to the target.
 */
function computeExpectedMaxScore(
  numSources: number,
  sourceModTypes: ModificationType[],
  pathDepths: number[],
  targetCriticality: CriticalityClassification,
): number {
  const criticalityScore = CRITICALITY_SCORES[targetCriticality];
  let maxScore = -1;

  for (let i = 0; i < numSources; i++) {
    const depth = pathDepths[i];
    const depthScore = computeDepthScore(depth);
    const changeTypeSev = CHANGE_TYPE_SEVERITY[sourceModTypes[i]];
    const score = computeImpactScore(depthScore, criticalityScore, changeTypeSev);
    if (score > maxScore) {
      maxScore = score;
    }
  }

  return maxScore;
}

// --- Property Tests ---

describe('Feature: blast-radius-visualizer, Property 10: Multi-Path Scoring Uses Maximum', () => {
  /**
   * **Validates: Requirements 4.6**
   *
   * For any resource reachable via multiple dependency paths from changed resources,
   * the Risk Assessor SHALL assign the Impact_Score corresponding to the highest-scoring path.
   */
  it('should assign the Impact_Score of the highest-scoring path when multiple paths exist', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryMultiPathScenario, async (scenario) => {
        const {
          numSources,
          sourceModTypes,
          pathDepths,
          targetCriticality,
          targetId,
          nodes,
          edges,
          manifestResources,
        } = scenario;

        const dependencyGraph: DependencyGraph = { nodes, edges };
        const manifest: ResourceChangeManifest = {
          version: '1.0',
          metadata: {
            submittedAt: new Date().toISOString(),
            sourceFormat: 'canonical',
          },
          resources: manifestResources,
        };

        const input: AssessorInput = { dependencyGraph, manifest };
        const result = await handler(input);

        // Find the scored target resource
        const targetScored = result.scoredResources.find(
          (r) => r.resourceId === targetId,
        );

        // Target must be scored
        expect(targetScored).toBeDefined();

        // Compute expected max score
        const expectedMaxScore = computeExpectedMaxScore(
          numSources,
          sourceModTypes,
          pathDepths,
          targetCriticality,
        );

        // The assigned score must equal the maximum path score
        expect(targetScored!.impactScore).toBe(expectedMaxScore);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.6**
   *
   * The score assigned via multi-path should always be >= any individual path's score.
   */
  it('should assign a score that is >= the score from any single path', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryMultiPathScenario, async (scenario) => {
        const {
          numSources,
          sourceModTypes,
          pathDepths,
          targetCriticality,
          targetId,
          nodes,
          edges,
          manifestResources,
        } = scenario;

        const dependencyGraph: DependencyGraph = { nodes, edges };
        const manifest: ResourceChangeManifest = {
          version: '1.0',
          metadata: {
            submittedAt: new Date().toISOString(),
            sourceFormat: 'canonical',
          },
          resources: manifestResources,
        };

        const input: AssessorInput = { dependencyGraph, manifest };
        const result = await handler(input);

        const targetScored = result.scoredResources.find(
          (r) => r.resourceId === targetId,
        );

        expect(targetScored).toBeDefined();

        const criticalityConfig = createCriticalityConfig();
        const criticalityScore = CRITICALITY_SCORES[
          criticalityConfig.getCriticality(scenario.targetResourceType)
        ];

        // Verify the assigned score is >= every individual path score
        for (let i = 0; i < numSources; i++) {
          const depth = pathDepths[i];
          const depthScore = computeDepthScore(depth);
          const changeTypeSev = CHANGE_TYPE_SEVERITY[sourceModTypes[i]];
          const pathScore = computeImpactScore(depthScore, criticalityScore, changeTypeSev);

          expect(targetScored!.impactScore).toBeGreaterThanOrEqual(pathScore);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 4.6**
   *
   * When all paths produce the same score, the assigned score equals that common value.
   */
  it('should assign the common score when all paths produce the same score', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          modType: arbitraryModificationType,
          depth: fc.integer({ min: 1, max: 5 }),
          targetCriticality: arbitraryCriticality,
          numSources: fc.integer({ min: 2, max: 4 }),
        }),
        async ({ modType, depth, targetCriticality, numSources }) => {
          const targetId = 'target-resource';
          const targetResourceType = RESOURCE_TYPES_BY_CRITICALITY[targetCriticality];

          const nodes: DependencyNode[] = [];
          const edges: DependencyEdge[] = [];
          const manifestResources: { resourceId: string; resourceType: string; provider: string; modificationType: ModificationType; region: string; accountId: string }[] = [];

          // Target node
          nodes.push({
            resourceId: targetId,
            resourceType: targetResourceType,
            provider: 'aws',
            region: 'us-east-1',
            accountId: '123456789012',
            isDirectChange: false,
            dependencyCoverage: 'full',
          });

          // All sources have same modType and same depth
          for (let i = 0; i < numSources; i++) {
            const sourceId = `source-${i}`;
            nodes.push({
              resourceId: sourceId,
              resourceType: 'AWS::EC2::Instance',
              provider: 'aws',
              region: 'us-east-1',
              accountId: '123456789012',
              isDirectChange: true,
              dependencyCoverage: 'full',
            });
            manifestResources.push({
              resourceId: sourceId,
              resourceType: 'AWS::EC2::Instance',
              provider: 'aws',
              modificationType: modType,
              region: 'us-east-1',
              accountId: '123456789012',
            });

            // Build path of given depth
            let prevNodeId = sourceId;
            for (let d = 1; d < depth; d++) {
              const intermediateId = `intermediate-${i}-${d}`;
              nodes.push({
                resourceId: intermediateId,
                resourceType: 'AWS::SNS::Topic',
                provider: 'aws',
                region: 'us-east-1',
                accountId: '123456789012',
                isDirectChange: false,
                dependencyCoverage: 'full',
              });
              edges.push({
                sourceId: prevNodeId,
                targetId: intermediateId,
                relationshipType: 'references',
                depth: d,
              });
              prevNodeId = intermediateId;
            }
            edges.push({
              sourceId: prevNodeId,
              targetId: targetId,
              relationshipType: 'references',
              depth: depth,
            });
          }

          const dependencyGraph: DependencyGraph = { nodes, edges };
          const manifest: ResourceChangeManifest = {
            version: '1.0',
            metadata: {
              submittedAt: new Date().toISOString(),
              sourceFormat: 'canonical',
            },
            resources: manifestResources,
          };

          const input: AssessorInput = { dependencyGraph, manifest };
          const result = await handler(input);

          const targetScored = result.scoredResources.find(
            (r) => r.resourceId === targetId,
          );

          expect(targetScored).toBeDefined();

          // All paths have same score, so the result should equal that score
          const depthScore = computeDepthScore(depth);
          const criticalityScore = CRITICALITY_SCORES[targetCriticality];
          const changeTypeSev = CHANGE_TYPE_SEVERITY[modType];
          const expectedScore = computeImpactScore(depthScore, criticalityScore, changeTypeSev);

          expect(targetScored!.impactScore).toBe(expectedScore);
        },
      ),
      { numRuns: 100 },
    );
  });
});
