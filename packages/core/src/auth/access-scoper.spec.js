"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const access_scoper_1 = require("./access-scoper");
// ─── extractPrincipalFromSigV4 ──────────────────────────────────────────────
(0, vitest_1.describe)('extractPrincipalFromSigV4', () => {
    (0, vitest_1.it)('extracts principal from standard API Gateway IAM auth context', () => {
        const event = {
            requestContext: {
                identity: {
                    userArn: 'arn:aws:iam::123456789012:user/deploy-bot',
                    accountId: '123456789012',
                },
            },
        };
        const result = (0, access_scoper_1.extractPrincipalFromSigV4)(event);
        (0, vitest_1.expect)(result).toEqual({
            principalArn: 'arn:aws:iam::123456789012:user/deploy-bot',
            accountId: '123456789012',
        });
    });
    (0, vitest_1.it)('extracts account ID from ARN when accountId field is missing', () => {
        const event = {
            requestContext: {
                identity: {
                    userArn: 'arn:aws:sts::987654321098:assumed-role/MyRole/session',
                },
            },
        };
        const result = (0, access_scoper_1.extractPrincipalFromSigV4)(event);
        (0, vitest_1.expect)(result).toEqual({
            principalArn: 'arn:aws:sts::987654321098:assumed-role/MyRole/session',
            accountId: '987654321098',
        });
    });
    (0, vitest_1.it)('extracts principal from custom authorizer principalId', () => {
        const event = {
            requestContext: {
                authorizer: {
                    principalId: 'arn:aws:iam::111222333444:role/CustomRole',
                },
            },
        };
        const result = (0, access_scoper_1.extractPrincipalFromSigV4)(event);
        (0, vitest_1.expect)(result).toEqual({
            principalArn: 'arn:aws:iam::111222333444:role/CustomRole',
            accountId: '111222333444',
        });
    });
    (0, vitest_1.it)('returns null when no identity context is present', () => {
        const event = {};
        (0, vitest_1.expect)((0, access_scoper_1.extractPrincipalFromSigV4)(event)).toBeNull();
    });
    (0, vitest_1.it)('returns null when requestContext is empty', () => {
        const event = { requestContext: {} };
        (0, vitest_1.expect)((0, access_scoper_1.extractPrincipalFromSigV4)(event)).toBeNull();
    });
    (0, vitest_1.it)('returns null when userArn is not a valid ARN', () => {
        const event = {
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
        const event2 = {
            requestContext: {
                identity: {
                    userArn: 'not-an-arn',
                },
            },
        };
        (0, vitest_1.expect)((0, access_scoper_1.extractPrincipalFromSigV4)(event2)).toBeNull();
    });
    (0, vitest_1.it)('returns null when authorizer principalId is not a valid ARN', () => {
        const event = {
            requestContext: {
                authorizer: {
                    principalId: 'just-a-username',
                },
            },
        };
        (0, vitest_1.expect)((0, access_scoper_1.extractPrincipalFromSigV4)(event)).toBeNull();
    });
});
// ─── scopeDependencyGraph ───────────────────────────────────────────────────
(0, vitest_1.describe)('scopeDependencyGraph', () => {
    const fullGraph = {
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
    (0, vitest_1.it)('returns all resources when policy authorizes all accounts and regions', () => {
        const policy = {
            authorizedAccounts: [],
            authorizedRegions: [],
        };
        const result = (0, access_scoper_1.scopeDependencyGraph)(fullGraph, policy);
        (0, vitest_1.expect)(result.graph.nodes).toHaveLength(4);
        (0, vitest_1.expect)(result.graph.edges).toHaveLength(3);
        (0, vitest_1.expect)(result.exclusionSummary.omittedResourceCount).toBe(0);
    });
    (0, vitest_1.it)('excludes resources from unauthorized accounts', () => {
        const policy = {
            authorizedAccounts: ['111111111111'],
            authorizedRegions: [],
        };
        const result = (0, access_scoper_1.scopeDependencyGraph)(fullGraph, policy);
        (0, vitest_1.expect)(result.graph.nodes).toHaveLength(2);
        (0, vitest_1.expect)(result.graph.nodes.map((n) => n.resourceId)).toEqual(['sg-001', 'ec2-002']);
        (0, vitest_1.expect)(result.exclusionSummary.excludedAccounts).toEqual(['222222222222', '333333333333']);
        (0, vitest_1.expect)(result.exclusionSummary.omittedResourceCount).toBe(2);
    });
    (0, vitest_1.it)('excludes resources from unauthorized regions', () => {
        const policy = {
            authorizedAccounts: [],
            authorizedRegions: ['us-east-1'],
        };
        const result = (0, access_scoper_1.scopeDependencyGraph)(fullGraph, policy);
        (0, vitest_1.expect)(result.graph.nodes).toHaveLength(2);
        (0, vitest_1.expect)(result.graph.nodes.map((n) => n.resourceId)).toEqual(['sg-001', 'ec2-002']);
        (0, vitest_1.expect)(result.exclusionSummary.excludedRegions).toEqual(['ap-southeast-1', 'eu-west-1']);
        (0, vitest_1.expect)(result.exclusionSummary.omittedResourceCount).toBe(2);
    });
    (0, vitest_1.it)('removes edges that reference unauthorized nodes', () => {
        const policy = {
            authorizedAccounts: ['111111111111'],
            authorizedRegions: [],
        };
        const result = (0, access_scoper_1.scopeDependencyGraph)(fullGraph, policy);
        // Only the edge between sg-001 and ec2-002 should remain
        (0, vitest_1.expect)(result.graph.edges).toHaveLength(1);
        (0, vitest_1.expect)(result.graph.edges[0]).toEqual({
            sourceId: 'sg-001',
            targetId: 'ec2-002',
            relationshipType: 'is_attached_to',
            depth: 1,
        });
    });
    (0, vitest_1.it)('handles empty graph', () => {
        const emptyGraph = { nodes: [], edges: [] };
        const policy = {
            authorizedAccounts: ['111111111111'],
            authorizedRegions: ['us-east-1'],
        };
        const result = (0, access_scoper_1.scopeDependencyGraph)(emptyGraph, policy);
        (0, vitest_1.expect)(result.graph.nodes).toHaveLength(0);
        (0, vitest_1.expect)(result.graph.edges).toHaveLength(0);
        (0, vitest_1.expect)(result.exclusionSummary.omittedResourceCount).toBe(0);
    });
    (0, vitest_1.it)('produces a meaningful exclusion summary message', () => {
        const policy = {
            authorizedAccounts: ['111111111111'],
            authorizedRegions: ['us-east-1'],
        };
        const result = (0, access_scoper_1.scopeDependencyGraph)(fullGraph, policy);
        (0, vitest_1.expect)(result.exclusionSummary.reason).toContain('omitted');
        (0, vitest_1.expect)(result.exclusionSummary.reason).toContain('insufficient read permissions');
    });
});
// ─── scopeScoredResources ───────────────────────────────────────────────────
(0, vitest_1.describe)('scopeScoredResources', () => {
    const resources = [
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
    (0, vitest_1.it)('returns all resources when policy authorizes everything', () => {
        const policy = {
            authorizedAccounts: [],
            authorizedRegions: [],
        };
        const result = (0, access_scoper_1.scopeScoredResources)(resources, policy);
        (0, vitest_1.expect)(result.resources).toHaveLength(3);
        (0, vitest_1.expect)(result.exclusionSummary.omittedResourceCount).toBe(0);
    });
    (0, vitest_1.it)('excludes resources from unauthorized accounts', () => {
        const policy = {
            authorizedAccounts: ['111111111111'],
            authorizedRegions: [],
        };
        const result = (0, access_scoper_1.scopeScoredResources)(resources, policy);
        (0, vitest_1.expect)(result.resources).toHaveLength(2);
        (0, vitest_1.expect)(result.resources.map((r) => r.resourceId)).toEqual(['sg-001', 'lambda-003']);
        (0, vitest_1.expect)(result.exclusionSummary.excludedAccounts).toEqual(['222222222222']);
        (0, vitest_1.expect)(result.exclusionSummary.omittedResourceCount).toBe(1);
    });
    (0, vitest_1.it)('does not expose any details of unauthorized resources', () => {
        const policy = {
            authorizedAccounts: ['111111111111'],
            authorizedRegions: [],
        };
        const result = (0, access_scoper_1.scopeScoredResources)(resources, policy);
        // Verify no resource from account 222222222222 is in the results
        for (const resource of result.resources) {
            (0, vitest_1.expect)(resource.accountId).not.toBe('222222222222');
        }
        // The exclusion summary only mentions account IDs, not resource details
        (0, vitest_1.expect)(result.exclusionSummary.excludedAccounts).toContain('222222222222');
    });
    (0, vitest_1.it)('handles empty resource list', () => {
        const policy = {
            authorizedAccounts: ['111111111111'],
            authorizedRegions: ['us-east-1'],
        };
        const result = (0, access_scoper_1.scopeScoredResources)([], policy);
        (0, vitest_1.expect)(result.resources).toHaveLength(0);
        (0, vitest_1.expect)(result.exclusionSummary.omittedResourceCount).toBe(0);
    });
});
// ─── createAuthenticationError ──────────────────────────────────────────────
(0, vitest_1.describe)('createAuthenticationError', () => {
    (0, vitest_1.it)('returns 401 status code', () => {
        const error = (0, access_scoper_1.createAuthenticationError)();
        (0, vitest_1.expect)(error.statusCode).toBe(401);
    });
    (0, vitest_1.it)('does not reveal internal system details', () => {
        const error = (0, access_scoper_1.createAuthenticationError)();
        (0, vitest_1.expect)(error.message).not.toContain('Lambda');
        (0, vitest_1.expect)(error.message).not.toContain('DynamoDB');
        (0, vitest_1.expect)(error.message).not.toContain('Step Functions');
        (0, vitest_1.expect)(error.message).not.toContain('internal');
        (0, vitest_1.expect)(error.message).toContain('SigV4');
    });
    (0, vitest_1.it)('provides a helpful error message', () => {
        const error = (0, access_scoper_1.createAuthenticationError)();
        (0, vitest_1.expect)(error.error).toBe('Unauthorized');
        (0, vitest_1.expect)(error.message).toContain('credentials');
    });
});
//# sourceMappingURL=access-scoper.spec.js.map