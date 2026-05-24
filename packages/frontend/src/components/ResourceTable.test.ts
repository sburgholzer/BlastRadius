import { describe, it, expect } from 'vitest';
import { sortResources, paginateResources, PAGE_SIZE } from './ResourceTable';
import type { ScoredResource } from '../api/types';

function makeScoredResource(overrides: Partial<ScoredResource> = {}): ScoredResource {
  return {
    resourceId: 'res-1',
    resourceType: 'AWS::EC2::Instance',
    provider: 'aws',
    region: 'us-east-1',
    accountId: '123456789012',
    impactScore: 50,
    riskCategory: 'High',
    dependencyChain: ['root', 'res-1'],
    dependencyDepth: 2,
    criticalityClassification: 'High',
    changeTypeSeverity: 80,
    ...overrides,
  };
}

describe('sortResources', () => {
  const resources: ScoredResource[] = [
    makeScoredResource({ resourceId: 'a', impactScore: 30, riskCategory: 'Low' }),
    makeScoredResource({ resourceId: 'b', impactScore: 90, riskCategory: 'Critical' }),
    makeScoredResource({ resourceId: 'c', impactScore: 60, riskCategory: 'High' }),
    makeScoredResource({ resourceId: 'd', impactScore: 45, riskCategory: 'Medium' }),
  ];

  it('sorts by impactScore descending by default', () => {
    const sorted = sortResources(resources);
    expect(sorted.map((r) => r.impactScore)).toEqual([90, 60, 45, 30]);
  });

  it('sorts by impactScore ascending', () => {
    const sorted = sortResources(resources, 'impactScore', 'asc');
    expect(sorted.map((r) => r.impactScore)).toEqual([30, 45, 60, 90]);
  });

  it('sorts by resourceId ascending', () => {
    const sorted = sortResources(resources, 'resourceId', 'asc');
    expect(sorted.map((r) => r.resourceId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sorts by resourceId descending', () => {
    const sorted = sortResources(resources, 'resourceId', 'desc');
    expect(sorted.map((r) => r.resourceId)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('sorts by riskCategory descending (Critical first)', () => {
    const sorted = sortResources(resources, 'riskCategory', 'desc');
    expect(sorted.map((r) => r.riskCategory)).toEqual([
      'Critical',
      'High',
      'Medium',
      'Low',
    ]);
  });

  it('sorts by riskCategory ascending (Low first)', () => {
    const sorted = sortResources(resources, 'riskCategory', 'asc');
    expect(sorted.map((r) => r.riskCategory)).toEqual([
      'Low',
      'Medium',
      'High',
      'Critical',
    ]);
  });

  it('sorts by region', () => {
    const regionResources = [
      makeScoredResource({ resourceId: 'a', region: 'us-west-2' }),
      makeScoredResource({ resourceId: 'b', region: 'eu-west-1' }),
      makeScoredResource({ resourceId: 'c', region: 'ap-southeast-1' }),
    ];
    const sorted = sortResources(regionResources, 'region', 'asc');
    expect(sorted.map((r) => r.region)).toEqual([
      'ap-southeast-1',
      'eu-west-1',
      'us-west-2',
    ]);
  });

  it('sorts by dependencyDepth', () => {
    const depthResources = [
      makeScoredResource({ resourceId: 'a', dependencyDepth: 3 }),
      makeScoredResource({ resourceId: 'b', dependencyDepth: 1 }),
      makeScoredResource({ resourceId: 'c', dependencyDepth: 5 }),
    ];
    const sorted = sortResources(depthResources, 'dependencyDepth', 'asc');
    expect(sorted.map((r) => r.dependencyDepth)).toEqual([1, 3, 5]);
  });

  it('does not mutate the original array', () => {
    const original = [...resources];
    sortResources(resources, 'impactScore', 'desc');
    expect(resources).toEqual(original);
  });

  it('handles empty array', () => {
    const sorted = sortResources([]);
    expect(sorted).toEqual([]);
  });

  it('handles single element', () => {
    const single = [makeScoredResource({ impactScore: 42 })];
    const sorted = sortResources(single);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].impactScore).toBe(42);
  });
});

describe('paginateResources', () => {
  // Generate a list of resources with sequential scores
  function generateResources(count: number): ScoredResource[] {
    return Array.from({ length: count }, (_, i) =>
      makeScoredResource({
        resourceId: `res-${i}`,
        impactScore: 100 - i,
      }),
    );
  }

  it('exports PAGE_SIZE as 50', () => {
    expect(PAGE_SIZE).toBe(50);
  });

  it('returns first 50 items for page 1 when more than 50 exist', () => {
    const resources = generateResources(120);
    const page = paginateResources(resources, 1);
    expect(page).toHaveLength(50);
    expect(page[0].resourceId).toBe('res-0');
    expect(page[49].resourceId).toBe('res-49');
  });

  it('returns second page of 50 items', () => {
    const resources = generateResources(120);
    const page = paginateResources(resources, 2);
    expect(page).toHaveLength(50);
    expect(page[0].resourceId).toBe('res-50');
    expect(page[49].resourceId).toBe('res-99');
  });

  it('returns remaining items on last page', () => {
    const resources = generateResources(120);
    const page = paginateResources(resources, 3);
    expect(page).toHaveLength(20);
    expect(page[0].resourceId).toBe('res-100');
    expect(page[19].resourceId).toBe('res-119');
  });

  it('returns all items when fewer than PAGE_SIZE', () => {
    const resources = generateResources(30);
    const page = paginateResources(resources, 1);
    expect(page).toHaveLength(30);
  });

  it('clamps page to valid range when page exceeds total', () => {
    const resources = generateResources(60);
    // Only 2 pages exist, requesting page 5 should return last page
    const page = paginateResources(resources, 5);
    expect(page).toHaveLength(10);
    expect(page[0].resourceId).toBe('res-50');
  });

  it('clamps page to 1 when page is 0 or negative', () => {
    const resources = generateResources(60);
    const page = paginateResources(resources, 0);
    expect(page).toHaveLength(50);
    expect(page[0].resourceId).toBe('res-0');
  });

  it('returns empty array for empty input', () => {
    const page = paginateResources([], 1);
    expect(page).toEqual([]);
  });

  it('handles exactly PAGE_SIZE items', () => {
    const resources = generateResources(50);
    const page = paginateResources(resources, 1);
    expect(page).toHaveLength(50);
    // Only 1 page, so page 2 should clamp to page 1
    const page2 = paginateResources(resources, 2);
    expect(page2).toHaveLength(50);
  });
});
