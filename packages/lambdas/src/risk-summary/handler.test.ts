/**
 * Unit tests for the Risk Summary Generator Lambda handler.
 *
 * Tests cover:
 * - Top-K resource selection (Requirement 8.2)
 * - Word limit enforcement (Requirement 8.1)
 * - Feature flag behavior (Requirement 8.5)
 * - Graceful failure handling (Requirement 8.4)
 * - Prompt construction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  selectTopResources,
  enforceWordLimit,
  buildPrompt,
  handler,
} from './handler';
import type { ScoredResource, RiskSummary, DependencyGraph } from '@blast-radius/core';

function makeScoredResource(overrides: Partial<ScoredResource> = {}): ScoredResource {
  return {
    resourceId: overrides.resourceId ?? 'res-1',
    resourceType: overrides.resourceType ?? 'AWS::EC2::Instance',
    provider: 'aws',
    region: 'us-east-1',
    accountId: '123456789012',
    impactScore: overrides.impactScore ?? 50,
    riskCategory: overrides.riskCategory ?? 'High',
    dependencyChain: overrides.dependencyChain ?? ['src-1', 'res-1'],
    dependencyDepth: overrides.dependencyDepth ?? 1,
    criticalityClassification: overrides.criticalityClassification ?? 'High',
    changeTypeSeverity: overrides.changeTypeSeverity ?? 80,
    highestRiskPath: overrides.highestRiskPath ?? [],
  };
}

const emptyGraph: DependencyGraph = { nodes: [], edges: [] };

const defaultRiskSummary: RiskSummary = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
  totalAffected: 10,
  highestScore: 95,
};

describe('selectTopResources', () => {
  it('returns top 3 resources sorted by impactScore descending', () => {
    const resources = [
      makeScoredResource({ resourceId: 'a', impactScore: 30 }),
      makeScoredResource({ resourceId: 'b', impactScore: 90 }),
      makeScoredResource({ resourceId: 'c', impactScore: 60 }),
      makeScoredResource({ resourceId: 'd', impactScore: 75 }),
      makeScoredResource({ resourceId: 'e', impactScore: 45 }),
    ];

    const result = selectTopResources(resources, 3);

    expect(result).toHaveLength(3);
    expect(result[0].resourceId).toBe('b');
    expect(result[1].resourceId).toBe('d');
    expect(result[2].resourceId).toBe('c');
  });

  it('returns all resources if fewer than k exist', () => {
    const resources = [
      makeScoredResource({ resourceId: 'a', impactScore: 80 }),
      makeScoredResource({ resourceId: 'b', impactScore: 50 }),
    ];

    const result = selectTopResources(resources, 3);

    expect(result).toHaveLength(2);
    expect(result[0].resourceId).toBe('a');
    expect(result[1].resourceId).toBe('b');
  });

  it('returns empty array for empty input', () => {
    const result = selectTopResources([], 3);
    expect(result).toHaveLength(0);
  });

  it('returns exactly 1 resource when k=1', () => {
    const resources = [
      makeScoredResource({ resourceId: 'a', impactScore: 30 }),
      makeScoredResource({ resourceId: 'b', impactScore: 90 }),
    ];

    const result = selectTopResources(resources, 1);

    expect(result).toHaveLength(1);
    expect(result[0].resourceId).toBe('b');
  });

  it('does not mutate the original array', () => {
    const resources = [
      makeScoredResource({ resourceId: 'a', impactScore: 30 }),
      makeScoredResource({ resourceId: 'b', impactScore: 90 }),
    ];
    const originalOrder = resources.map((r) => r.resourceId);

    selectTopResources(resources, 3);

    expect(resources.map((r) => r.resourceId)).toEqual(originalOrder);
  });
});

describe('enforceWordLimit', () => {
  it('returns text unchanged if within limit', () => {
    const text = 'This is a short summary with only a few words.';
    expect(enforceWordLimit(text, 500)).toBe(text);
  });

  it('truncates text exceeding the word limit at sentence boundary', () => {
    const words = Array.from({ length: 600 }, (_, i) => `word${i}`);
    // Insert sentence endings
    words[100] = 'end.';
    words[400] = 'boundary.';
    const text = words.join(' ');

    const result = enforceWordLimit(text, 500);
    const resultWords = result.split(/\s+/).filter((w) => w.length > 0);

    expect(resultWords.length).toBeLessThanOrEqual(500);
    expect(result.endsWith('.')).toBe(true);
  });

  it('truncates at word limit if no sentence boundary found', () => {
    const words = Array.from({ length: 600 }, (_, i) => `word${i}`);
    const text = words.join(' ');

    const result = enforceWordLimit(text, 500);
    const resultWords = result.split(/\s+/).filter((w) => w.length > 0);

    expect(resultWords.length).toBe(500);
  });

  it('handles empty string', () => {
    expect(enforceWordLimit('', 500)).toBe('');
  });

  it('handles exactly 500 words', () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
    const text = words.join(' ');

    const result = enforceWordLimit(text, 500);
    expect(result).toBe(text);
  });
});

describe('buildPrompt', () => {
  it('includes resource details in the prompt', () => {
    const resources = [
      makeScoredResource({
        resourceId: 'sg-123',
        resourceType: 'AWS::EC2::SecurityGroup',
        impactScore: 85,
        riskCategory: 'Critical',
      }),
    ];

    const prompt = buildPrompt(resources, defaultRiskSummary);

    expect(prompt).toContain('AWS::EC2::SecurityGroup');
    expect(prompt).toContain('sg-123');
    expect(prompt).toContain('85/100');
    expect(prompt).toContain('Critical risk');
    expect(prompt).toContain('500 words');
  });

  it('includes risk summary totals', () => {
    const prompt = buildPrompt([makeScoredResource()], defaultRiskSummary);

    expect(prompt).toContain('Total affected resources: 10');
    expect(prompt).toContain('Critical: 1');
    expect(prompt).toContain('High: 2');
    expect(prompt).toContain('Highest impact score: 95/100');
  });
});

describe('handler', () => {
  beforeEach(() => {
    vi.stubEnv('ENABLE_BEDROCK_SUMMARY', '');
    vi.stubEnv('BEDROCK_MODEL_ID', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('skips summary generation when feature flag is disabled', async () => {
    vi.stubEnv('ENABLE_BEDROCK_SUMMARY', 'false');

    const result = await handler({
      scoredResources: [makeScoredResource()],
      riskSummary: defaultRiskSummary,
      dependencyGraph: emptyGraph,
      enableSummary: false,
    });

    expect(result.skipped).toBe(true);
    expect(result.summary).toBeUndefined();
    expect(result.generationDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('skips when enableSummary input is explicitly false', async () => {
    const result = await handler({
      scoredResources: [makeScoredResource()],
      riskSummary: defaultRiskSummary,
      dependencyGraph: emptyGraph,
      enableSummary: false,
    });

    expect(result.skipped).toBe(true);
    expect(result.summary).toBeUndefined();
  });

  it('returns empty blast radius message when no scored resources', async () => {
    const result = await handler({
      scoredResources: [],
      riskSummary: { critical: 0, high: 0, medium: 0, low: 0, totalAffected: 0, highestScore: 0 },
      dependencyGraph: emptyGraph,
      enableSummary: true,
    });

    expect(result.skipped).toBe(false);
    expect(result.summary).toContain('No resources were affected');
  });

  it('returns gracefully with error on Bedrock failure', async () => {
    // With enableSummary=true and resources present, it will try to call Bedrock
    // which will fail since we're not in AWS — this tests graceful degradation
    vi.stubEnv('ENABLE_BEDROCK_SUMMARY', 'true');

    const result = await handler({
      scoredResources: [makeScoredResource({ impactScore: 90 })],
      riskSummary: defaultRiskSummary,
      dependencyGraph: emptyGraph,
      enableSummary: true,
    });

    expect(result.skipped).toBe(false);
    expect(result.summary).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(result.generationDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('uses environment variable feature flag when enableSummary not provided', async () => {
    vi.stubEnv('ENABLE_BEDROCK_SUMMARY', 'false');

    const result = await handler({
      scoredResources: [makeScoredResource()],
      riskSummary: defaultRiskSummary,
      dependencyGraph: emptyGraph,
    });

    // enableSummary not provided, env var is 'false', so isFeatureEnabled() returns false
    expect(result.skipped).toBe(true);
  });

  it('enables summary when env var is "true"', async () => {
    vi.stubEnv('ENABLE_BEDROCK_SUMMARY', 'true');

    const result = await handler({
      scoredResources: [makeScoredResource()],
      riskSummary: defaultRiskSummary,
      dependencyGraph: emptyGraph,
    });

    // Will attempt Bedrock call and fail gracefully in test env
    expect(result.skipped).toBe(false);
  });

  it('enables summary when env var is "1"', async () => {
    vi.stubEnv('ENABLE_BEDROCK_SUMMARY', '1');

    const result = await handler({
      scoredResources: [makeScoredResource()],
      riskSummary: defaultRiskSummary,
      dependencyGraph: emptyGraph,
    });

    expect(result.skipped).toBe(false);
  });
});
