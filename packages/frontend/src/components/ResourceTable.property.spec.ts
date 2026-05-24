/**
 * Property-based tests for tabular sorting in ResourceTable.
 *
 * Feature: blast-radius-visualizer
 * Property 13: Tabular View Sorted by Impact Score Descending
 *
 * Validates: Requirements 6.5
 *
 * For any set of scored resources, the tabular summary view SHALL list them
 * in strictly non-increasing order of Impact_Score.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { sortResources } from './ResourceTable';
import type { ScoredResource, RiskCategory } from '../api/types';

// --- Custom Arbitraries / Generators ---

const RISK_CATEGORIES: RiskCategory[] = ['Critical', 'High', 'Medium', 'Low'];

function arbitraryResourceId(): fc.Arbitrary<string> {
  return fc
    .stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')),
      { minLength: 3, maxLength: 20 },
    )
    .map((s) => `res-${s}`);
}

function arbitraryResourceType(): fc.Arbitrary<string> {
  return fc.constantFrom(
    'AWS::EC2::Instance',
    'AWS::Lambda::Function',
    'AWS::RDS::DBInstance',
    'AWS::S3::Bucket',
    'AWS::DynamoDB::Table',
    'AWS::ECS::Service',
  );
}

function arbitraryScoredResource(): fc.Arbitrary<ScoredResource> {
  return fc.record({
    resourceId: arbitraryResourceId(),
    resourceType: arbitraryResourceType(),
    provider: fc.constant('aws'),
    region: fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'),
    accountId: fc.stringOf(fc.constantFrom(...'0123456789'.split('')), {
      minLength: 12,
      maxLength: 12,
    }),
    impactScore: fc.integer({ min: 0, max: 100 }),
    riskCategory: fc.constantFrom(...RISK_CATEGORIES),
    dependencyChain: fc.array(arbitraryResourceId(), { minLength: 1, maxLength: 5 }),
    dependencyDepth: fc.integer({ min: 1, max: 10 }),
    criticalityClassification: fc.constantFrom(...RISK_CATEGORIES),
    changeTypeSeverity: fc.constantFrom(100, 80, 50),
  });
}

// --- Property-Based Tests ---

describe('Feature: blast-radius-visualizer, Property 13: Tabular View Sorted by Impact Score Descending', () => {
  /**
   * **Validates: Requirements 6.5**
   *
   * For any set of scored resources, sorting by impactScore descending (the
   * default tabular view sort) produces a list in strictly non-increasing
   * order of impactScore.
   */
  it('sortResources produces non-increasing order of impactScore when sorted descending', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 100 }),
        (resources) => {
          const sorted = sortResources(resources, 'impactScore', 'desc');

          // Verify non-increasing order: each element's score >= next element's score
          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i].impactScore).toBeGreaterThanOrEqual(
              sorted[i + 1].impactScore,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * The default sort (no explicit field/direction) also produces non-increasing
   * order of impactScore, confirming the tabular view's default behavior.
   */
  it('default sortResources (no args) produces non-increasing order of impactScore', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 100 }),
        (resources) => {
          const sorted = sortResources(resources);

          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i].impactScore).toBeGreaterThanOrEqual(
              sorted[i + 1].impactScore,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.5**
   *
   * Sorting preserves all resources — no elements are lost or duplicated.
   * The sorted output has the same length and same set of impactScores as the input.
   */
  it('sorting preserves all resources (same length and same scores)', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryScoredResource(), { minLength: 0, maxLength: 100 }),
        (resources) => {
          const sorted = sortResources(resources, 'impactScore', 'desc');

          expect(sorted).toHaveLength(resources.length);

          const inputScores = resources.map((r) => r.impactScore).sort((a, b) => a - b);
          const outputScores = sorted.map((r) => r.impactScore).sort((a, b) => a - b);
          expect(outputScores).toEqual(inputScores);
        },
      ),
      { numRuns: 100 },
    );
  });
});
