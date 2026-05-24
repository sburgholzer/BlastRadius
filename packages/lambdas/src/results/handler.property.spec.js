"use strict";
/**
 * Property-based tests for result retrieval authorization.
 *
 * Feature: blast-radius-visualizer
 * Property 19: Result Retrieval Respects Authorization
 *
 * **Validates: Requirements 9.7**
 *
 * For any requesting principal and any set of stored analysis results with
 * various owner tags, the retrieval endpoint SHALL return only results tagged
 * with that principal's identity or results for accounts the principal is
 * currently authorized to access.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fc = __importStar(require("fast-check"));
const handler_1 = require("./handler");
// ─── Custom Arbitraries / Generators ─────────────────────────────────────────
const REGIONS = [
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'eu-central-1',
    'ap-southeast-1',
];
const RESOURCE_TYPES = [
    'AWS::EC2::Instance',
    'AWS::RDS::DBInstance',
    'AWS::Lambda::Function',
    'AWS::S3::Bucket',
];
/** Generates a 12-digit AWS account ID. */
function arbitraryAccountId() {
    return fc.stringOf(fc.constantFrom(...'0123456789'.split('')), {
        minLength: 12,
        maxLength: 12,
    });
}
/** Generates a valid IAM ARN for a given account ID. */
function arbitraryPrincipalArn(accountId) {
    return `arn:aws:iam::${accountId}:user/test-user`;
}
/** Generates a unique analysis ID. */
function arbitraryAnalysisId() {
    return fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 8, maxLength: 16 }).map((s) => `analysis-${s}`);
}
/** Generates a minimal valid AnalysisResult for a given principal and account. */
function createMockAnalysisResult(analysisId, principalArn, accountId) {
    return {
        analysisId,
        status: 'completed',
        requestingPrincipal: principalArn,
        originatingAccountId: accountId,
        sourceFormat: 'canonical',
        submittedAt: '2024-01-15T10:30:00Z',
        completedAt: '2024-01-15T10:31:00Z',
        manifest: {
            version: '1.0',
            metadata: {
                submittedAt: '2024-01-15T10:30:00Z',
                sourceFormat: 'canonical',
            },
            resources: [
                {
                    resourceType: 'AWS::EC2::Instance',
                    resourceId: `i-${analysisId.slice(0, 8)}`,
                    provider: 'aws',
                    modificationType: 'Modify',
                    region: 'us-east-1',
                    accountId,
                },
            ],
        },
        dependencyGraph: {
            nodes: [
                {
                    resourceId: `i-${analysisId.slice(0, 8)}`,
                    resourceType: 'AWS::EC2::Instance',
                    provider: 'aws',
                    region: 'us-east-1',
                    accountId,
                    isDirectChange: true,
                    dependencyCoverage: 'full',
                },
            ],
            edges: [],
        },
        scoredResources: [
            {
                resourceId: `i-${analysisId.slice(0, 8)}`,
                resourceType: 'AWS::EC2::Instance',
                provider: 'aws',
                region: 'us-east-1',
                accountId,
                impactScore: 50,
                riskCategory: 'High',
                dependencyChain: [`i-${analysisId.slice(0, 8)}`],
                dependencyDepth: 1,
                criticalityClassification: 'High',
                changeTypeSeverity: 50,
                highestRiskPath: [],
            },
        ],
        riskSummary: {
            critical: 0,
            high: 1,
            medium: 0,
            low: 0,
            totalAffected: 1,
            highestScore: 50,
        },
        stageDurations: { ingestion: 100, scoring: 200 },
        completedStages: ['ingestion', 'scoring'],
    };
}
/**
 * Creates mock dependencies for the handler that simulate DynamoDB and S3
 * with in-memory stores.
 */
function createMockDeps(statusRecords, s3Results, authPolicy) {
    const docClient = {
        send: async (command) => {
            const cmd = command;
            const cmdName = cmd.constructor?.name ?? '';
            if (cmdName === 'GetCommand' || (cmd.input && 'Key' in cmd.input && !('IndexName' in cmd.input))) {
                const key = cmd.input.Key?.analysisId;
                const item = statusRecords[key];
                return { Item: item ?? undefined };
            }
            if (cmdName === 'QueryCommand' || (cmd.input && 'IndexName' in cmd.input)) {
                const indexName = cmd.input.IndexName;
                const expressionValues = cmd.input.ExpressionAttributeValues;
                if (indexName === 'principalIndex') {
                    const principal = expressionValues[':principal'];
                    const items = Object.values(statusRecords).filter((r) => r.requestingPrincipal === principal);
                    return { Items: items, LastEvaluatedKey: undefined };
                }
                if (indexName === 'accountIndex') {
                    const accountId = expressionValues[':accountId'];
                    const items = Object.values(statusRecords).filter((r) => r.originatingAccountId === accountId);
                    return { Items: items, LastEvaluatedKey: undefined };
                }
                return { Items: [], LastEvaluatedKey: undefined };
            }
            return { Item: undefined, Items: [] };
        },
    };
    const s3Client = {
        send: async (command) => {
            const cmd = command;
            const key = cmd.input?.Key;
            const result = s3Results[key];
            if (!result) {
                throw new Error('NoSuchKey');
            }
            return {
                Body: {
                    transformToString: async () => JSON.stringify(result),
                },
            };
        },
    };
    const authResolver = {
        async resolvePolicy() {
            return authPolicy;
        },
    };
    return { docClient, s3Client, authResolver };
}
/**
 * Generates a complete test scenario with a requesting principal, their owned results,
 * results from authorized accounts, and results from unauthorized accounts.
 */
function arbitraryTestScenario() {
    return fc
        .record({
        requestingAccountId: arbitraryAccountId(),
        otherAuthorizedAccounts: fc.uniqueArray(arbitraryAccountId(), { minLength: 0, maxLength: 2 }),
        unauthorizedAccounts: fc.uniqueArray(arbitraryAccountId(), { minLength: 1, maxLength: 3 }),
        ownedResultCount: fc.integer({ min: 0, max: 3 }),
        authorizedResultCount: fc.integer({ min: 0, max: 3 }),
        unauthorizedResultCount: fc.integer({ min: 1, max: 3 }),
    })
        .filter(({ requestingAccountId, otherAuthorizedAccounts, unauthorizedAccounts }) => 
    // Ensure no overlap between all account sets
    !otherAuthorizedAccounts.includes(requestingAccountId) &&
        !unauthorizedAccounts.includes(requestingAccountId) &&
        !otherAuthorizedAccounts.some((a) => unauthorizedAccounts.includes(a)))
        .chain(({ requestingAccountId, otherAuthorizedAccounts, unauthorizedAccounts, ownedResultCount, authorizedResultCount, unauthorizedResultCount, }) => {
        const requestingPrincipalArn = arbitraryPrincipalArn(requestingAccountId);
        const authorizedAccounts = [requestingAccountId, ...otherAuthorizedAccounts];
        // Generate analysis IDs for each category
        return fc
            .record({
            ownedIds: fc.uniqueArray(arbitraryAnalysisId(), {
                minLength: ownedResultCount,
                maxLength: ownedResultCount,
            }),
            authorizedIds: fc.uniqueArray(arbitraryAnalysisId(), {
                minLength: authorizedResultCount,
                maxLength: authorizedResultCount,
            }),
            unauthorizedIds: fc.uniqueArray(arbitraryAnalysisId(), {
                minLength: unauthorizedResultCount,
                maxLength: unauthorizedResultCount,
            }),
        })
            .filter(({ ownedIds, authorizedIds, unauthorizedIds }) => 
        // Ensure all analysis IDs are unique across categories
        new Set([...ownedIds, ...authorizedIds, ...unauthorizedIds]).size ===
            ownedIds.length + authorizedIds.length + unauthorizedIds.length)
            .map(({ ownedIds, authorizedIds, unauthorizedIds }) => {
            const ownedResults = ownedIds.map((id) => ({
                analysisId: id,
                accountId: requestingAccountId,
            }));
            const authorizedAccountResults = authorizedIds.map((id, i) => ({
                analysisId: id,
                accountId: otherAuthorizedAccounts.length > 0
                    ? otherAuthorizedAccounts[i % otherAuthorizedAccounts.length]
                    : requestingAccountId,
                principalArn: arbitraryPrincipalArn(otherAuthorizedAccounts.length > 0
                    ? otherAuthorizedAccounts[i % otherAuthorizedAccounts.length]
                    : requestingAccountId),
            }));
            const unauthorizedResults = unauthorizedIds.map((id, i) => ({
                analysisId: id,
                accountId: unauthorizedAccounts[i % unauthorizedAccounts.length],
                principalArn: arbitraryPrincipalArn(unauthorizedAccounts[i % unauthorizedAccounts.length]),
            }));
            return {
                requestingPrincipalArn,
                requestingAccountId,
                authorizedAccounts,
                ownedResults,
                authorizedAccountResults,
                unauthorizedResults,
            };
        });
    });
}
/** Builds mock deps from a test scenario. */
function buildDepsFromScenario(scenario) {
    const statusRecords = {};
    const s3Results = {};
    // Add owned results
    for (const { analysisId, accountId } of scenario.ownedResults) {
        const resultLocation = `results/${analysisId}.json`;
        statusRecords[analysisId] = {
            analysisId,
            requestingPrincipal: scenario.requestingPrincipalArn,
            originatingAccountId: accountId,
            status: 'completed',
            currentStage: 'complete',
            progressPercentage: 100,
            elapsedTimeMs: 1000,
            startedAt: '2024-01-15T10:30:00Z',
            updatedAt: '2024-01-15T10:31:00Z',
            resultLocation,
        };
        s3Results[resultLocation] = createMockAnalysisResult(analysisId, scenario.requestingPrincipalArn, accountId);
    }
    // Add authorized account results (owned by other principals)
    for (const { analysisId, accountId, principalArn } of scenario.authorizedAccountResults) {
        const resultLocation = `results/${analysisId}.json`;
        statusRecords[analysisId] = {
            analysisId,
            requestingPrincipal: principalArn,
            originatingAccountId: accountId,
            status: 'completed',
            currentStage: 'complete',
            progressPercentage: 100,
            elapsedTimeMs: 1000,
            startedAt: '2024-01-15T10:30:00Z',
            updatedAt: '2024-01-15T10:31:00Z',
            resultLocation,
        };
        s3Results[resultLocation] = createMockAnalysisResult(analysisId, principalArn, accountId);
    }
    // Add unauthorized results
    for (const { analysisId, accountId, principalArn } of scenario.unauthorizedResults) {
        const resultLocation = `results/${analysisId}.json`;
        statusRecords[analysisId] = {
            analysisId,
            requestingPrincipal: principalArn,
            originatingAccountId: accountId,
            status: 'completed',
            currentStage: 'complete',
            progressPercentage: 100,
            elapsedTimeMs: 1000,
            startedAt: '2024-01-15T10:30:00Z',
            updatedAt: '2024-01-15T10:31:00Z',
            resultLocation,
        };
        s3Results[resultLocation] = createMockAnalysisResult(analysisId, principalArn, accountId);
    }
    const authPolicy = {
        authorizedAccounts: scenario.authorizedAccounts,
        authorizedRegions: [], // empty means all regions authorized
    };
    const deps = createMockDeps(statusRecords, s3Results, authPolicy);
    return { deps, statusRecords, s3Results };
}
// ─── Property Tests ──────────────────────────────────────────────────────────
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 19: Result Retrieval Respects Authorization', () => {
    /**
     * **Validates: Requirements 9.7**
     *
     * GET operation: requesting principal can retrieve results they own.
     */
    (0, vitest_1.it)('get operation returns results owned by the requesting principal', async () => {
        await fc.assert(fc.asyncProperty(arbitraryTestScenario().filter((s) => s.ownedResults.length > 0), async (scenario) => {
            const { deps } = buildDepsFromScenario(scenario);
            // Pick the first owned result
            const ownedResult = scenario.ownedResults[0];
            const input = {
                operation: 'get',
                analysisId: ownedResult.analysisId,
                requestContext: {
                    identity: {
                        userArn: scenario.requestingPrincipalArn,
                        accountId: scenario.requestingAccountId,
                    },
                },
            };
            const result = await (0, handler_1.handler)(input, deps);
            // Should succeed (not an error)
            (0, vitest_1.expect)(result).not.toHaveProperty('statusCode');
            const output = result;
            (0, vitest_1.expect)(output.result).toBeDefined();
            (0, vitest_1.expect)(output.result.analysisId).toBe(ownedResult.analysisId);
            (0, vitest_1.expect)(output.result.requestingPrincipal).toBe(scenario.requestingPrincipalArn);
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 9.7**
     *
     * GET operation: requesting principal can retrieve results for accounts
     * they are authorized to access.
     */
    (0, vitest_1.it)('get operation returns results for authorized accounts', async () => {
        await fc.assert(fc.asyncProperty(arbitraryTestScenario().filter((s) => s.authorizedAccountResults.length > 0), async (scenario) => {
            const { deps } = buildDepsFromScenario(scenario);
            // Pick the first authorized account result
            const authorizedResult = scenario.authorizedAccountResults[0];
            const input = {
                operation: 'get',
                analysisId: authorizedResult.analysisId,
                requestContext: {
                    identity: {
                        userArn: scenario.requestingPrincipalArn,
                        accountId: scenario.requestingAccountId,
                    },
                },
            };
            const result = await (0, handler_1.handler)(input, deps);
            // Should succeed (not a 403 error)
            if ('statusCode' in result) {
                (0, vitest_1.expect)(result.statusCode).not.toBe(403);
            }
            else {
                const output = result;
                (0, vitest_1.expect)(output.result).toBeDefined();
                (0, vitest_1.expect)(output.result.analysisId).toBe(authorizedResult.analysisId);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 9.7**
     *
     * GET operation: requesting principal CANNOT retrieve results for accounts
     * they are NOT authorized to access (and that they don't own).
     */
    (0, vitest_1.it)('get operation denies access to results from unauthorized accounts', async () => {
        await fc.assert(fc.asyncProperty(arbitraryTestScenario(), async (scenario) => {
            const { deps } = buildDepsFromScenario(scenario);
            // Try to access each unauthorized result
            for (const unauthorizedResult of scenario.unauthorizedResults) {
                const input = {
                    operation: 'get',
                    analysisId: unauthorizedResult.analysisId,
                    requestContext: {
                        identity: {
                            userArn: scenario.requestingPrincipalArn,
                            accountId: scenario.requestingAccountId,
                        },
                    },
                };
                const result = await (0, handler_1.handler)(input, deps);
                // Should be denied with 403
                (0, vitest_1.expect)(result).toHaveProperty('statusCode');
                (0, vitest_1.expect)(result.statusCode).toBe(403);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 9.7**
     *
     * LIST operation: returns only results the principal owns or is authorized
     * to access. Never returns unauthorized results.
     */
    (0, vitest_1.it)('list operation returns only owned and authorized results, never unauthorized', async () => {
        await fc.assert(fc.asyncProperty(arbitraryTestScenario(), async (scenario) => {
            const { deps } = buildDepsFromScenario(scenario);
            const input = {
                operation: 'list',
                requestContext: {
                    identity: {
                        userArn: scenario.requestingPrincipalArn,
                        accountId: scenario.requestingAccountId,
                    },
                },
            };
            const result = await (0, handler_1.handler)(input, deps);
            // Should not be an error
            (0, vitest_1.expect)(result).not.toHaveProperty('statusCode');
            const output = result;
            // Collect all returned analysis IDs
            const returnedIds = new Set(output.results.map((r) => r.analysisId));
            // Collect the set of unauthorized analysis IDs
            const unauthorizedIds = new Set(scenario.unauthorizedResults.map((r) => r.analysisId));
            // No unauthorized result should appear in the returned list
            for (const id of returnedIds) {
                (0, vitest_1.expect)(unauthorizedIds.has(id)).toBe(false);
            }
            // All owned results should appear in the returned list
            for (const owned of scenario.ownedResults) {
                (0, vitest_1.expect)(returnedIds.has(owned.analysisId)).toBe(true);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 9.7**
     *
     * Unauthenticated requests (no SigV4 context) are rejected.
     */
    (0, vitest_1.it)('rejects requests without valid SigV4 authentication context', async () => {
        await fc.assert(fc.asyncProperty(arbitraryTestScenario(), async (scenario) => {
            const { deps } = buildDepsFromScenario(scenario);
            // Request with no authentication context
            const input = {
                operation: 'get',
                analysisId: scenario.ownedResults.length > 0
                    ? scenario.ownedResults[0].analysisId
                    : 'any-id',
                requestContext: undefined,
            };
            const result = await (0, handler_1.handler)(input, deps);
            // Should be rejected with 401
            (0, vitest_1.expect)(result).toHaveProperty('statusCode');
            (0, vitest_1.expect)(result.statusCode).toBe(401);
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=handler.property.spec.js.map