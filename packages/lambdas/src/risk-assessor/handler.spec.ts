/**
 * Property-based tests for Impact Score formula correctness.
 *
 * Feature: blast-radius-visualizer, Property 8: Impact Score Formula Correctness
 *
 * Validates: Requirements 4.2, 4.5
 *
 * For any combination of dependency depth (1-10), resource criticality
 * (Critical, High, Medium, Low), and change type (Remove, Replace, Modify),
 * the Risk Assessor SHALL compute Impact_Score as:
 *   round((depthScore * 0.30) + (criticalityScore * 0.40) + (changeTypeSeverity * 0.30))
 * where depthScore = max(10, 100 - ((depth-1) * 10)),
 *       criticalityScore ∈ {100, 75, 50, 25},
 *       changeTypeSeverity ∈ {100, 80, 50}.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeDepthScore, computeImpactScore, classifyRisk } from './handler';

// --- Constants for reference ---

const CRITICALITY_MAP: Record<string, number> = {
  Critical: 100,
  High: 75,
  Medium: 50,
  Low: 25,
};

const CHANGE_TYPE_MAP: Record<string, number> = {
  Remove: 100,
  Replace: 80,
  Modify: 50,
};

// --- Generators ---

/** Generates a valid depth value (1-10). */
const arbitraryDepth = fc.integer({ min: 1, max: 10 });

/** Generates a valid criticality classification. */
const arbitraryCriticality = fc.constantFrom(
  ...Object.keys(CRITICALITY_MAP) as ('Critical' | 'High' | 'Medium' | 'Low')[]
);

/** Generates a valid change type. */
const arbitraryChangeType = fc.constantFrom(
  ...Object.keys(CHANGE_TYPE_MAP) as ('Remove' | 'Replace' | 'Modify')[]
);

// --- Property Tests ---

describe('Feature: blast-radius-visualizer, Property 8: Impact Score Formula Correctness', () => {
  /**
   * **Validates: Requirements 4.2, 4.5**
   *
   * Property 1: For any depth 1-10, depthScore = max(10, 100 - ((depth-1) * 10))
   */
  it('should compute depthScore as max(10, 100 - ((depth-1) * 10)) for any depth 1-10', () => {
    fc.assert(
      fc.property(arbitraryDepth, (depth) => {
        const result = computeDepthScore(depth);
        const expected = Math.max(10, 100 - (depth - 1) * 10);

        expect(result).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.2, 4.5**
   *
   * Property 2: For any valid inputs, Impact_Score = round((depthScore * 0.30) + (criticalityScore * 0.40) + (changeTypeSeverity * 0.30))
   */
  it('should compute Impact_Score using the formula round((depthScore * 0.30) + (criticalityScore * 0.40) + (changeTypeSeverity * 0.30))', () => {
    fc.assert(
      fc.property(
        arbitraryDepth,
        arbitraryCriticality,
        arbitraryChangeType,
        (depth, criticality, changeType) => {
          const depthScore = computeDepthScore(depth);
          const criticalityScore = CRITICALITY_MAP[criticality];
          const changeTypeSeverity = CHANGE_TYPE_MAP[changeType];

          const result = computeImpactScore(depthScore, criticalityScore, changeTypeSeverity);
          const expected = Math.round(
            depthScore * 0.30 + criticalityScore * 0.40 + changeTypeSeverity * 0.30
          );

          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.2, 4.5**
   *
   * Property 3: Impact_Score is always in range [0, 100]
   */
  it('should always produce an Impact_Score in range [0, 100]', () => {
    fc.assert(
      fc.property(
        arbitraryDepth,
        arbitraryCriticality,
        arbitraryChangeType,
        (depth, criticality, changeType) => {
          const depthScore = computeDepthScore(depth);
          const criticalityScore = CRITICALITY_MAP[criticality];
          const changeTypeSeverity = CHANGE_TYPE_MAP[changeType];

          const result = computeImpactScore(depthScore, criticalityScore, changeTypeSeverity);

          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(100);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.2, 4.5**
   *
   * Property 4: Depth score is monotonically decreasing with depth
   */
  it('should produce monotonically decreasing depth scores as depth increases', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9 }),
        (depth) => {
          const scoreAtDepth = computeDepthScore(depth);
          const scoreAtNextDepth = computeDepthScore(depth + 1);

          expect(scoreAtDepth).toBeGreaterThanOrEqual(scoreAtNextDepth);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.2, 4.5**
   *
   * Property 5: Higher criticality always produces higher score (all else equal)
   */
  it('should produce higher Impact_Score for higher criticality (all else equal)', () => {
    const criticalityOrder = ['Low', 'Medium', 'High', 'Critical'] as const;

    fc.assert(
      fc.property(
        arbitraryDepth,
        arbitraryChangeType,
        fc.integer({ min: 0, max: 2 }),
        (depth, changeType, lowerIdx) => {
          const depthScore = computeDepthScore(depth);
          const changeTypeSeverity = CHANGE_TYPE_MAP[changeType];

          const lowerCriticality = criticalityOrder[lowerIdx];
          const higherCriticality = criticalityOrder[lowerIdx + 1];

          const lowerScore = computeImpactScore(
            depthScore,
            CRITICALITY_MAP[lowerCriticality],
            changeTypeSeverity
          );
          const higherScore = computeImpactScore(
            depthScore,
            CRITICALITY_MAP[higherCriticality],
            changeTypeSeverity
          );

          expect(higherScore).toBeGreaterThanOrEqual(lowerScore);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.2, 4.5**
   *
   * Property 6: Higher change type severity always produces higher score (all else equal)
   */
  it('should produce higher Impact_Score for higher change type severity (all else equal)', () => {
    const changeTypeOrder = ['Modify', 'Replace', 'Remove'] as const;

    fc.assert(
      fc.property(
        arbitraryDepth,
        arbitraryCriticality,
        fc.integer({ min: 0, max: 1 }),
        (depth, criticality, lowerIdx) => {
          const depthScore = computeDepthScore(depth);
          const criticalityScore = CRITICALITY_MAP[criticality];

          const lowerChangeType = changeTypeOrder[lowerIdx];
          const higherChangeType = changeTypeOrder[lowerIdx + 1];

          const lowerScore = computeImpactScore(
            depthScore,
            criticalityScore,
            CHANGE_TYPE_MAP[lowerChangeType]
          );
          const higherScore = computeImpactScore(
            depthScore,
            criticalityScore,
            CHANGE_TYPE_MAP[higherChangeType]
          );

          expect(higherScore).toBeGreaterThanOrEqual(lowerScore);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// --- Property 9: Score-to-Category Classification ---

describe('Feature: blast-radius-visualizer, Property 9: Score-to-Category Classification', () => {
  /**
   * **Validates: Requirements 4.3**
   *
   * Property 9.1: Scores 75-100 are classified as Critical
   */
  it('should classify scores 75-100 as Critical', () => {
    fc.assert(
      fc.property(fc.integer({ min: 75, max: 100 }), (score) => {
        const category = classifyRisk(score);
        expect(category).toBe('Critical');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * Property 9.2: Scores 50-74 are classified as High
   */
  it('should classify scores 50-74 as High', () => {
    fc.assert(
      fc.property(fc.integer({ min: 50, max: 74 }), (score) => {
        const category = classifyRisk(score);
        expect(category).toBe('High');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * Property 9.3: Scores 25-49 are classified as Medium
   */
  it('should classify scores 25-49 as Medium', () => {
    fc.assert(
      fc.property(fc.integer({ min: 25, max: 49 }), (score) => {
        const category = classifyRisk(score);
        expect(category).toBe('Medium');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * Property 9.4: Scores 0-24 are classified as Low
   */
  it('should classify scores 0-24 as Low', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 24 }), (score) => {
        const category = classifyRisk(score);
        expect(category).toBe('Low');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * Property 9.5: Classification is exhaustive — every score 0-100 maps to exactly one category
   */
  it('should map every score 0-100 to exactly one of the four risk categories', () => {
    const validCategories = ['Critical', 'High', 'Medium', 'Low'] as const;

    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (score) => {
        const category = classifyRisk(score);

        // Must be one of the valid categories
        expect(validCategories).toContain(category);

        // Verify mutual exclusivity: exactly one category matches
        const matchingCategories = validCategories.filter((cat) => {
          switch (cat) {
            case 'Critical': return score >= 75 && score <= 100;
            case 'High': return score >= 50 && score <= 74;
            case 'Medium': return score >= 25 && score <= 49;
            case 'Low': return score >= 0 && score <= 24;
          }
        });

        expect(matchingCategories).toHaveLength(1);
        expect(category).toBe(matchingCategories[0]);
      }),
      { numRuns: 100 }
    );
  });
});
