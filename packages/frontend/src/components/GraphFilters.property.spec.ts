import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { applyFilters, type GraphFilterState } from './GraphFilters';
import type { RiskCategory, ScoredResource } from '../api/types';

/**
 * Property-based tests for Graph Filtering.
 *
 * Feature: blast-radius-visualizer
 * Property 12: Graph Filtering Returns Only Matching Resources
 *
 * **Validates: Requirements 6.4**
 *
 * For any scored dependency graph and any combination of filters (risk category,
 * resource type, source IaC tool), the filtered result SHALL contain only resources
 * that match all applied filter criteria, and SHALL contain all resources from the
 * original graph that match.
 */

// --- Custom Arbitraries / Generators ---

const ALL_RISK_CATEGORIES: RiskCategory[] = ['Critical', 'High', 'Medium', 'Low'];
const SAMPLE_RESOURCE_TYPES = [
  'AWS::EC2::Instance',
  'AWS::S3::Bucket',
  'AWS::Lambda::Function',
  'AWS::RDS::DBInstance',
  'AWS::EC2::SecurityGroup',
  'AWS::IAM::Role',
  'AWS::DynamoDB::Table',
  'AWS::ECS::Service',
];
const SAMPLE_PROVIDERS = ['aws', 'azure', 'gcp', 'terraform', 'pulumi'];

function arbitraryRiskCategory(): fc.Arbitrary<RiskCategory> {
  return fc.constantFrom(...ALL_RISK_CATEGORIES);
}

function arbitraryResourceType(): fc.Arbitrary<string> {
  return fc.constantFrom(...SAMPLE_RESOURCE_TYPES);
}

function arbitraryProvider(): fc.Arbitrary<string> {
  return fc.constantFrom(...SAMPLE_PROVIDERS);
}

function arbitraryScoredResource(): fc.Arbitrary<ScoredResource> {
  return fc.record({
    resourceId: fc.uuid(),
    resourceType: arbitraryResourceType(),
    provider: arbitraryProvider(),
    region: fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'),
    accountId: fc.stringOf(fc.constantFrom(...'0123456789'.split('')), {
      minLength: 12,
      maxLength: 12,
    }),
    impactScore: fc.integer({ min: 0, max: 100 }),
    riskCategory: arbitraryRiskCategory(),
    dependencyChain: fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
    dependencyDepth: fc.integer({ min: 1, max: 10 }),
    criticalityClassification: arbitraryRiskCategory(),
    changeTypeSeverity: fc.constantFrom(50, 80, 100),
  });
}

function arbitraryScoredResources(): fc.Arbitrary<ScoredResource[]> {
  return fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 30 });
}

function arbitraryFilterState(
  resources: ScoredResource[],
): fc.Arbitrary<GraphFilterState> {
  const availableTypes = [...new Set(resources.map((r) => r.resourceType))];
  const availableProviders = [...new Set(resources.map((r) => r.provider))];

  return fc.record({
    riskCategories: fc.subarray(ALL_RISK_CATEGORIES).map((arr) => new Set(arr)),
    resourceTypes: fc
      .subarray(availableTypes.length > 0 ? availableTypes : ['none'])
      .map((arr) => new Set(arr)),
    sourceTools: fc
      .subarray(availableProviders.length > 0 ? availableProviders : ['none'])
      .map((arr) => new Set(arr)),
    showDirectChanges: fc.boolean(),
  });
}

/**
 * Determines whether a resource matches the given filter state.
 * A filter dimension with no selections means "show all" for that dimension.
 */
function resourceMatchesFilters(
  resource: ScoredResource,
  filters: GraphFilterState,
): boolean {
  const matchesRisk =
    filters.riskCategories.size === 0 ||
    filters.riskCategories.has(resource.riskCategory);
  const matchesType =
    filters.resourceTypes.size === 0 ||
    filters.resourceTypes.has(resource.resourceType);
  const matchesTool =
    filters.sourceTools.size === 0 ||
    filters.sourceTools.has(resource.provider);
  return matchesRisk && matchesType && matchesTool;
}

describe('Feature: blast-radius-visualizer, Property 12: Graph Filtering Returns Only Matching Resources', () => {
  /**
   * **Validates: Requirements 6.4**
   *
   * Every resource in the filtered result matches ALL applied filter criteria.
   */
  it('filtered result contains only resources matching all filter criteria', () => {
    fc.assert(
      fc.property(arbitraryScoredResources(), (resources) => {
        return fc.assert(
          fc.property(arbitraryFilterState(resources), (filters) => {
            const result = applyFilters(resources, filters);

            for (const resource of result) {
              expect(resourceMatchesFilters(resource, filters)).toBe(true);
            }
          }),
          { numRuns: 1 },
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * Every resource from the original graph that matches all filter criteria
   * is present in the filtered result (completeness).
   */
  it('filtered result contains all matching resources from the original graph', () => {
    fc.assert(
      fc.property(arbitraryScoredResources(), (resources) => {
        return fc.assert(
          fc.property(arbitraryFilterState(resources), (filters) => {
            const result = applyFilters(resources, filters);

            const expectedMatching = resources.filter((r) =>
              resourceMatchesFilters(r, filters),
            );

            expect(result.length).toBe(expectedMatching.length);

            for (const expected of expectedMatching) {
              expect(result).toContain(expected);
            }
          }),
          { numRuns: 1 },
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * With no filters active (all sets empty), all resources are returned.
   */
  it('empty filters return all resources unchanged', () => {
    fc.assert(
      fc.property(arbitraryScoredResources(), (resources) => {
        const emptyFilters: GraphFilterState = {
          riskCategories: new Set(),
          resourceTypes: new Set(),
          sourceTools: new Set(), showDirectChanges: true,
        };

        const result = applyFilters(resources, emptyFilters);
        expect(result).toEqual(resources);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * The filtered result is always a subset of the original resources
   * (no new resources are introduced by filtering).
   */
  it('filtered result is a subset of the original resources', () => {
    fc.assert(
      fc.property(arbitraryScoredResources(), (resources) => {
        return fc.assert(
          fc.property(arbitraryFilterState(resources), (filters) => {
            const result = applyFilters(resources, filters);

            for (const resource of result) {
              expect(resources).toContain(resource);
            }
          }),
          { numRuns: 1 },
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * Filtering preserves the original order of resources (no reordering).
   */
  it('filtering preserves original resource order', () => {
    fc.assert(
      fc.property(arbitraryScoredResources(), (resources) => {
        return fc.assert(
          fc.property(arbitraryFilterState(resources), (filters) => {
            const result = applyFilters(resources, filters);

            // Verify order is preserved by checking indices
            let lastIndex = -1;
            for (const resource of result) {
              const currentIndex = resources.indexOf(resource);
              expect(currentIndex).toBeGreaterThan(lastIndex);
              lastIndex = currentIndex;
            }
          }),
          { numRuns: 1 },
        );
      }),
      { numRuns: 100 },
    );
  });
});
