import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildJsonExport } from './ExportPanel';
import type { RiskCategory, ScoredResource } from '../api/types';

/**
 * Property-based tests for JSON Export.
 *
 * Feature: blast-radius-visualizer
 * Property 14: JSON Export Contains All Required Fields
 *
 * **Validates: Requirements 6.6, 6.8**
 *
 * For any set of scored resources, the JSON export SHALL include for each resource:
 * resource type, resource identifier, Impact_Score, risk category, and dependency chain.
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

function arbitraryScoredResource(): fc.Arbitrary<ScoredResource> {
  return fc.record({
    resourceId: fc.uuid(),
    resourceType: fc.constantFrom(...SAMPLE_RESOURCE_TYPES),
    provider: fc.constantFrom(...SAMPLE_PROVIDERS),
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
  return fc.array(arbitraryScoredResource(), { minLength: 1, maxLength: 20 });
}

describe('Feature: blast-radius-visualizer, Property 14: JSON Export Contains All Required Fields', () => {
  /**
   * **Validates: Requirements 6.6, 6.8**
   *
   * Every resource in the JSON export contains the required field: resourceType.
   */
  it('every exported resource has a resourceType field', () => {
    fc.assert(
      fc.property(arbitraryScoredResources(), fc.uuid(), (resources, analysisId) => {
        const report = buildJsonExport(resources, analysisId);

        for (const entry of report.resources) {
          expect(entry).toHaveProperty('resourceType');
          expect(typeof entry.resourceType).toBe('string');
          expect(entry.resourceType.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.6, 6.8**
   *
   * Every resource in the JSON export contains the required field: resourceId.
   */
  it('every exported resource has a resourceId field', () => {
    fc.assert(
      fc.property(arbitraryScoredResources(), fc.uuid(), (resources, analysisId) => {
        const report = buildJsonExport(resources, analysisId);

        for (const entry of report.resources) {
          expect(entry).toHaveProperty('resourceId');
          expect(typeof entry.resourceId).toBe('string');
          expect(entry.resourceId.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.6, 6.8**
   *
   * Every resource in the JSON export contains the required field: impactScore.
   */
  it('every exported resource has an impactScore field', () => {
    fc.assert(
      fc.property(arbitraryScoredResources(), fc.uuid(), (resources, analysisId) => {
        const report = buildJsonExport(resources, analysisId);

        for (const entry of report.resources) {
          expect(entry).toHaveProperty('impactScore');
          expect(typeof entry.impactScore).toBe('number');
          expect(entry.impactScore).toBeGreaterThanOrEqual(0);
          expect(entry.impactScore).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.6, 6.8**
   *
   * Every resource in the JSON export contains the required field: riskCategory.
   */
  it('every exported resource has a riskCategory field', () => {
    fc.assert(
      fc.property(arbitraryScoredResources(), fc.uuid(), (resources, analysisId) => {
        const report = buildJsonExport(resources, analysisId);

        for (const entry of report.resources) {
          expect(entry).toHaveProperty('riskCategory');
          expect(ALL_RISK_CATEGORIES).toContain(entry.riskCategory);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.6, 6.8**
   *
   * Every resource in the JSON export contains the required field: dependencyChain.
   */
  it('every exported resource has a dependencyChain field', () => {
    fc.assert(
      fc.property(arbitraryScoredResources(), fc.uuid(), (resources, analysisId) => {
        const report = buildJsonExport(resources, analysisId);

        for (const entry of report.resources) {
          expect(entry).toHaveProperty('dependencyChain');
          expect(Array.isArray(entry.dependencyChain)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.6, 6.8**
   *
   * The JSON export preserves the exact values from the input scored resources
   * for all required fields.
   */
  it('exported fields match the original scored resource values', () => {
    fc.assert(
      fc.property(arbitraryScoredResources(), fc.uuid(), (resources, analysisId) => {
        const report = buildJsonExport(resources, analysisId);

        expect(report.resources.length).toBe(resources.length);

        for (let i = 0; i < resources.length; i++) {
          const original = resources[i];
          const exported = report.resources[i];

          expect(exported.resourceType).toBe(original.resourceType);
          expect(exported.resourceId).toBe(original.resourceId);
          expect(exported.impactScore).toBe(original.impactScore);
          expect(exported.riskCategory).toBe(original.riskCategory);
          expect(exported.dependencyChain).toEqual(original.dependencyChain);
        }
      }),
      { numRuns: 100 },
    );
  });
});
