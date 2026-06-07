import { describe, it, expect } from 'vitest';
import { applyFilters, type GraphFilterState } from './GraphFilters';
import type { RiskCategory, ScoredResource } from '../api/types';

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
    dependencyDepth: 1,
    criticalityClassification: 'High',
    changeTypeSeverity: 80,
    ...overrides,
  };
}

describe('applyFilters', () => {
  const resources: ScoredResource[] = [
    makeScoredResource({
      resourceId: 'sg-001',
      resourceType: 'AWS::EC2::SecurityGroup',
      riskCategory: 'Critical',
      provider: 'aws',
    }),
    makeScoredResource({
      resourceId: 'i-001',
      resourceType: 'AWS::EC2::Instance',
      riskCategory: 'High',
      provider: 'aws',
    }),
    makeScoredResource({
      resourceId: 'bucket-001',
      resourceType: 'AWS::S3::Bucket',
      riskCategory: 'Medium',
      provider: 'aws',
    }),
    makeScoredResource({
      resourceId: 'log-001',
      resourceType: 'AWS::CloudWatch::LogGroup',
      riskCategory: 'Low',
      provider: 'aws',
    }),
    makeScoredResource({
      resourceId: 'vm-001',
      resourceType: 'azurerm_virtual_machine',
      riskCategory: 'High',
      provider: 'azure',
    }),
  ];

  it('returns all resources when no filters are active', () => {
    const filters: GraphFilterState = {
      riskCategories: new Set(),
      resourceTypes: new Set(),
      sourceTools: new Set(), showDirectChanges: true,
    };
    const result = applyFilters(resources, filters);
    expect(result).toHaveLength(5);
    expect(result).toEqual(resources);
  });

  it('filters by single risk category', () => {
    const filters: GraphFilterState = {
      riskCategories: new Set<RiskCategory>(['Critical']),
      resourceTypes: new Set(),
      sourceTools: new Set(), showDirectChanges: true,
    };
    const result = applyFilters(resources, filters);
    expect(result).toHaveLength(1);
    expect(result[0].resourceId).toBe('sg-001');
  });

  it('filters by multiple risk categories', () => {
    const filters: GraphFilterState = {
      riskCategories: new Set<RiskCategory>(['Critical', 'High']),
      resourceTypes: new Set(),
      sourceTools: new Set(), showDirectChanges: true,
    };
    const result = applyFilters(resources, filters);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.resourceId)).toEqual(['sg-001', 'i-001', 'vm-001']);
  });

  it('filters by resource type', () => {
    const filters: GraphFilterState = {
      riskCategories: new Set(),
      resourceTypes: new Set(['AWS::S3::Bucket']),
      sourceTools: new Set(), showDirectChanges: true,
    };
    const result = applyFilters(resources, filters);
    expect(result).toHaveLength(1);
    expect(result[0].resourceId).toBe('bucket-001');
  });

  it('filters by source tool (provider)', () => {
    const filters: GraphFilterState = {
      riskCategories: new Set(),
      resourceTypes: new Set(),
      sourceTools: new Set(['azure']), showDirectChanges: true,
    };
    const result = applyFilters(resources, filters);
    expect(result).toHaveLength(1);
    expect(result[0].resourceId).toBe('vm-001');
  });

  it('applies intersection of all filter dimensions', () => {
    const filters: GraphFilterState = {
      riskCategories: new Set<RiskCategory>(['High']),
      resourceTypes: new Set(['AWS::EC2::Instance']),
      sourceTools: new Set(['aws']), showDirectChanges: true,
    };
    const result = applyFilters(resources, filters);
    expect(result).toHaveLength(1);
    expect(result[0].resourceId).toBe('i-001');
  });

  it('returns empty when filters exclude all resources', () => {
    const filters: GraphFilterState = {
      riskCategories: new Set<RiskCategory>(['Critical']),
      resourceTypes: new Set(['AWS::S3::Bucket']),
      sourceTools: new Set(), showDirectChanges: true,
    };
    const result = applyFilters(resources, filters);
    expect(result).toHaveLength(0);
  });

  it('handles empty resource list', () => {
    const filters: GraphFilterState = {
      riskCategories: new Set<RiskCategory>(['Critical']),
      resourceTypes: new Set(),
      sourceTools: new Set(), showDirectChanges: true,
    };
    const result = applyFilters([], filters);
    expect(result).toHaveLength(0);
  });

  it('filters by multiple resource types', () => {
    const filters: GraphFilterState = {
      riskCategories: new Set(),
      resourceTypes: new Set(['AWS::EC2::Instance', 'AWS::S3::Bucket']),
      sourceTools: new Set(), showDirectChanges: true,
    };
    const result = applyFilters(resources, filters);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.resourceId)).toEqual(['i-001', 'bucket-001']);
  });
});
