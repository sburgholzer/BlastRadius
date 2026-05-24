import { describe, it, expect } from 'vitest';
import {
  extractPrincipalFromSigV4,
  scopeDependencyGraph,
  scopeScoredResources,
  createAuthenticationError,
} from './access-scoper';
import type {
  SigV4RequestContext,
  AuthorizationPolicy,
} from './access-scoper';
import type { DependencyGraph } from '../models/dependency-graph';
import type { ScoredResource } from '../models/scored-resource';

// ─── extractPrincipalFromSigV4 ──────────────────────────────────────────────

describe('extractPrincipalFromSigV4', () => {
  it('extracts principal from standard API Gateway IAM auth context', () => {
    const event: SigV4RequestContext = {
      requestContext: {
        identity: {
          userArn: 'arn:aws:iam::123456789012:user/deploy-bot',
          accountId: '123456789012',
        },
      },
    };

    const result = extractPrincipalFromSigV4(event);
    expect(result).toEqual({
      principalArn: 'arn:aws:iam::123456789012:user/deploy-bot',
      accountId: '123456789012',
    });
  });

  it('extracts account ID from ARN when accountId field is missing', () => {
    const event: SigV4RequestContext = {
      requestContext: {
        identity: {
          userArn: 'arn:aws:sts::987654321098:assumed-role/MyRole/session',
        },
      },
    };

    const result = extractPrincipalFromSigV4(event);
    expect(result).toEqual({
      principalArn: 'arn:aws:sts::987654321098:assumed-role/MyRole/session',
      accountId: '987654321098',
    });
  });

  it('extracts principal from custom authorizer principalId', () => {
    const event: SigV4RequestContext = {
      requestContext: {
        authorizer: {
          principalId: 'arn:aws:iam::111222333444:role/CustomRole',
        },
      },
    };

    const result = extractPrincipalFromSigV4(event);
    expect(result).toEqual({
      principalArn: 'arn:aws:iam::111222333444:role/CustomRole',
      accountId: '111222333444',
    });
  });

  it('returns null when no identity context is present', () => {
    const event: SigV4RequestContext = {};
    expect(extractPrincipalFromSigV4(event)).toBeNull();
  });

  it('returns null when requestContext is empty', () => {
    const event: SigV4RequestContext = { requestContext: {} };
    expect(extractPrincipalFromSigV4(event)).toBeNull();
  });

  it('returns null when userArn is not a valid ARN', () => {
    const event: SigV4RequestContext = {
      requestContext: {
        identity: {
          userArn: 'not-an-arn',
          accountId: '123456789012',
        },
      },
    };

    // userArn is present but extractAccountFromArn will fail on invalid format
    // However, accountId is provided directly, so it should still work
    // Actually, the function checks if accountId is provided OR extracts from ARN
    // Let's test with a truly invalid scenario
    const event2: SigV4RequestContext = {
      requestContext: {
        identity: {
          userArn: 'not-an-arn',
        },
      },
    };
    expect(extractPrincipalFromSigV4(event2)).toBeNull();
  });

  it('returns null when authorizer principalId is not a valid ARN', () => {
    const event: SigV4RequestContext = {
      requestContext: {
        authorizer: {
          principalId: 'just-a-username',
        },
      },
    };
    expect(extractPrincipalFromSigV4(event)).toBeNull();
  });
});

// ─── scopeDependencyGraph ───────────────────────────────────────────────────

describe('scopeDependencyGraph', () => {
  const fullGraph: DependencyGraph = {
    nodes: [
      {
        resourceId: 'sg-001',
        resourceType: 'AWS::EC2::SecurityGroup',
        provider: 'aws',
        region: 'us-east-1',
        accountId: '111111111111',
        isDirectChange: true,
        dependencyCoverage: 'full',
      },
      {
        resourceId: 'ec2-002',
        resourceType: 'AWS::EC2::Instance',
        provider: 'aws',
        region: 'us-east-1',
        accountId: '111111111111',
        isDirectChange: false,
        dependencyCoverage: 'full',
      },
      {
        resourceId: 'rds-003',
        resourceType: 'AWS::RDS::DBInstance',
        provider: 'aws',
        region: 'eu-west-1',
        accountId: '222222222222',
        isDirectChange: false,
        dependencyCoverage: 'full',
      },
      {
        resourceId: 'lambda-004',
        resourceType: 'AWS::Lambda::Function',
        provider: 'aws',
        region: 'ap-southeast-1',
        accountId: '333333333333',
        isDirectChange: false,
        dependencyCoverage: 'partial',
      },
    ],
    edges: [
      { sourceId: 'sg-001', targetId: 'ec2-002', relationshipType: 'is_attached_to', depth: 1 },
      { sourceId: 'sg-001', targetId: 'rds-003', relationshipType: 'references', depth: 1 },
      { sourceId: 'ec2-002', targetId: 'lambda-004', relationshipType: 'invokes', depth: 2 },
    ],
  };

  it('returns all resources when policy authorizes all accounts and regions', () => {
    const policy: AuthorizationPolicy = {
      authorizedAccounts: [],
      authorizedRegions: [],
    };

    const result = scopeDependencyGraph(fullGraph, policy);
    expect(result.graph.nodes).toHaveLength(4);
    expect(result.graph.edges).toHaveLength(3);
    expect(result.exclusionSummary.omittedResourceCount).toBe(0);
  });

  it('excludes resources from unauthorized accounts', () => {
    const policy: AuthorizationPolicy = {
      authorizedAccounts: ['111111111111'],
      authorizedRegions: [],
    };

    const result = scopeDependencyGraph(fullGraph, policy);
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.nodes.map((n) => n.resourceId)).toEqual(['sg-001', 'ec2-002']);
    expect(result.exclusionSummary.excludedAccounts).toEqual(['222222222222', '333333333333']);
    expect(result.exclusionSummary.omittedResourceCount).toBe(2);
  });

  it('excludes resources from unauthorized regions', () => {
    const policy: AuthorizationPolicy = {
      authorizedAccounts: [],
      authorizedRegions: ['us-east-1'],
    };

    const result = scopeDependencyGraph(fullGraph, policy);
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.nodes.map((n) => n.resourceId)).toEqual(['sg-001', 'ec2-002']);
    expect(result.exclusionSummary.excludedRegions).toEqual(['ap-southeast-1', 'eu-west-1']);
    expect(result.exclusionSummary.omittedResourceCount).toBe(2);
  });

  it('removes edges that reference unauthorized nodes', () => {
    const policy: AuthorizationPolicy = {
      authorizedAccounts: ['111111111111'],
      authorizedRegions: [],
    };

    const result = scopeDependencyGraph(fullGraph, policy);
    // Only the edge between sg-001 and ec2-002 should remain
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.edges[0]).toEqual({
      sourceId: 'sg-001',
      targetId: 'ec2-002',
      relationshipType: 'is_attached_to',
      depth: 1,
    });
  });

  it('handles empty graph', () => {
    const emptyGraph: DependencyGraph = { nodes: [], edges: [] };
    const policy: AuthorizationPolicy = {
      authorizedAccounts: ['111111111111'],
      authorizedRegions: ['us-east-1'],
    };

    const result = scopeDependencyGraph(emptyGraph, policy);
    expect(result.graph.nodes).toHaveLength(0);
    expect(result.graph.edges).toHaveLength(0);
    expect(result.exclusionSummary.omittedResourceCount).toBe(0);
  });

  it('produces a meaningful exclusion summary message', () => {
    const policy: AuthorizationPolicy = {
      authorizedAccounts: ['111111111111'],
      authorizedRegions: ['us-east-1'],
    };

    const result = scopeDependencyGraph(fullGraph, policy);
    expect(result.exclusionSummary.reason).toContain('omitted');
    expect(result.exclusionSummary.reason).toContain('insufficient read permissions');
  });
});

// ─── scopeScoredResources ───────────────────────────────────────────────────

describe('scopeScoredResources', () => {
  const resources: ScoredResource[] = [
    {
      resourceId: 'sg-001',
      resourceType: 'AWS::EC2::SecurityGroup',
      provider: 'aws',
      region: 'us-east-1',
      accountId: '111111111111',
      impactScore: 85,
      riskCategory: 'Critical',
      dependencyChain: ['sg-001'],
      dependencyDepth: 1,
      criticalityClassification: 'Medium',
      changeTypeSeverity: 100,
      highestRiskPath: [],
    },
    {
      resourceId: 'rds-002',
      resourceType: 'AWS::RDS::DBInstance',
      provider: 'aws',
      region: 'eu-west-1',
      accountId: '222222222222',
      impactScore: 92,
      riskCategory: 'Critical',
      dependencyChain: ['sg-001', 'rds-002'],
      dependencyDepth: 2,
      criticalityClassification: 'Critical',
      changeTypeSeverity: 100,
      highestRiskPath: [],
    },
    {
      resourceId: 'lambda-003',
      resourceType: 'AWS::Lambda::Function',
      provider: 'aws',
      region: 'us-east-1',
      accountId: '111111111111',
      impactScore: 55,
      riskCategory: 'High',
      dependencyChain: ['sg-001', 'lambda-003'],
      dependencyDepth: 2,
      criticalityClassification: 'High',
      changeTypeSeverity: 50,
      highestRiskPath: [],
    },
  ];

  it('returns all resources when policy authorizes everything', () => {
    const policy: AuthorizationPolicy = {
      authorizedAccounts: [],
      authorizedRegions: [],
    };

    const result = scopeScoredResources(resources, policy);
    expect(result.resources).toHaveLength(3);
    expect(result.exclusionSummary.omittedResourceCount).toBe(0);
  });

  it('excludes resources from unauthorized accounts', () => {
    const policy: AuthorizationPolicy = {
      authorizedAccounts: ['111111111111'],
      authorizedRegions: [],
    };

    const result = scopeScoredResources(resources, policy);
    expect(result.resources).toHaveLength(2);
    expect(result.resources.map((r) => r.resourceId)).toEqual(['sg-001', 'lambda-003']);
    expect(result.exclusionSummary.excludedAccounts).toEqual(['222222222222']);
    expect(result.exclusionSummary.omittedResourceCount).toBe(1);
  });

  it('does not expose any details of unauthorized resources', () => {
    const policy: AuthorizationPolicy = {
      authorizedAccounts: ['111111111111'],
      authorizedRegions: [],
    };

    const result = scopeScoredResources(resources, policy);
    // Verify no resource from account 222222222222 is in the results
    for (const resource of result.resources) {
      expect(resource.accountId).not.toBe('222222222222');
    }
    // The exclusion summary only mentions account IDs, not resource details
    expect(result.exclusionSummary.excludedAccounts).toContain('222222222222');
  });

  it('handles empty resource list', () => {
    const policy: AuthorizationPolicy = {
      authorizedAccounts: ['111111111111'],
      authorizedRegions: ['us-east-1'],
    };

    const result = scopeScoredResources([], policy);
    expect(result.resources).toHaveLength(0);
    expect(result.exclusionSummary.omittedResourceCount).toBe(0);
  });
});

// ─── createAuthenticationError ──────────────────────────────────────────────

describe('createAuthenticationError', () => {
  it('returns 401 status code', () => {
    const error = createAuthenticationError();
    expect(error.statusCode).toBe(401);
  });

  it('does not reveal internal system details', () => {
    const error = createAuthenticationError();
    expect(error.message).not.toContain('Lambda');
    expect(error.message).not.toContain('DynamoDB');
    expect(error.message).not.toContain('Step Functions');
    expect(error.message).not.toContain('internal');
    expect(error.message).toContain('SigV4');
  });

  it('provides a helpful error message', () => {
    const error = createAuthenticationError();
    expect(error.error).toBe('Unauthorized');
    expect(error.message).toContain('credentials');
  });
});
