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

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { handler } from './handler';
import type {
  ResultsHandlerDeps,
  GetResultInput,
  ListResultsInput,
  GetResultOutput,
  ListResultsOutput,
  ResultsError,
  ResultsResult,
} from './handler';
import type {
  AuthorizationPolicy,
  AuthorizationResolver,
  AnalysisResult,
} from '@blast-radius/core';

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
function arbitraryAccountId(): fc.Arbitrary<string> {
  return fc.stringOf(fc.constantFrom(...'0123456789'.split('')), {
    minLength: 12,
    maxLength: 12,
  });
}

/** Generates a valid IAM ARN for a given account ID. */
function arbitraryPrincipalArn(accountId: string): string {
  return `arn:aws:iam::${accountId}:user/test-user`;
}

/** Generates a unique analysis ID. */
function arbitraryAnalysisId(): fc.Arbitrary<string> {
  return fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    { minLength: 8, maxLength: 16 },
  ).map((s) => `analysis-${s}`);
}

/** Generates a minimal valid AnalysisResult for a given principal and account. */
function createMockAnalysisResult(
  analysisId: string,
  principalArn: string,
  accountId: string,
): AnalysisResult {
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
function createMockDeps(
  statusRecords: Record<string, Record<string, unknown>>,
  s3Results: Record<string, AnalysisResult>,
  authPolicy: AuthorizationPolicy,
): ResultsHandlerDeps {
  const docClient = {
    send: async (command: unknown): Promise<unknown> => {
      const cmd = command as { input: Record<string, unknown>; constructor: { name: string } };
      const cmdName = cmd.constructor?.name ?? '';

      if (cmdName === 'GetCommand' || (cmd.input && 'Key' in cmd.input && !('IndexName' in cmd.input))) {
        const key = (cmd.input as { Key: { analysisId: string } }).Key?.analysisId;
        const item = statusRecords[key];
        return { Item: item ?? undefined };
      }

      if (cmdName === 'QueryCommand' || (cmd.input && 'IndexName' in cmd.input)) {
        const indexName = cmd.input.IndexName as string;
        const expressionValues = cmd.input.ExpressionAttributeValues as Record<string, string>;

        if (indexName === 'principalIndex') {
          const principal = expressionValues[':principal'];
          const items = Object.values(statusRecords).filter(
            (r) => r.requestingPrincipal === principal,
          );
          return { Items: items, LastEvaluatedKey: undefined };
        }

        if (indexName === 'accountIndex') {
          const accountId = expressionValues[':accountId'];
          const items = Object.values(statusRecords).filter(
            (r) => r.originatingAccountId === accountId,
          );
          return { Items: items, LastEvaluatedKey: undefined };
        }

        return { Items: [], LastEvaluatedKey: undefined };
      }

      return { Item: undefined, Items: [] };
    },
  } as unknown as ResultsHandlerDeps['docClient'];

  const s3Client = {
    send: async (command: unknown): Promise<unknown> => {
      const cmd = command as { input: { Key: string } };
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
  } as unknown as ResultsHandlerDeps['s3Client'];

  const authResolver: AuthorizationResolver = {
    async resolvePolicy(): Promise<AuthorizationPolicy> {
      return authPolicy;
    },
  };

  return { docClient, s3Client, authResolver };
}

// ─── Test Scenario Generator ─────────────────────────────────────────────────

interface TestScenario {
  requestingPrincipalArn: string;
  requestingAccountId: string;
  authorizedAccounts: string[];
  ownedResults: { analysisId: string; accountId: string }[];
  authorizedAccountResults: { analysisId: string; accountId: string; principalArn: string }[];
  unauthorizedResults: { analysisId: string; accountId: string; principalArn: string }[];
}

/**
 * Generates a complete test scenario with a requesting principal, their owned results,
 * results from authorized accounts, and results from unauthorized accounts.
 */
function arbitraryTestScenario(): fc.Arbitrary<TestScenario> {
  return fc
    .record({
      requestingAccountId: arbitraryAccountId(),
      otherAuthorizedAccounts: fc.uniqueArray(arbitraryAccountId(), { minLength: 0, maxLength: 2 }),
      unauthorizedAccounts: fc.uniqueArray(arbitraryAccountId(), { minLength: 1, maxLength: 3 }),
      ownedResultCount: fc.integer({ min: 0, max: 3 }),
      authorizedResultCount: fc.integer({ min: 0, max: 3 }),
      unauthorizedResultCount: fc.integer({ min: 1, max: 3 }),
    })
    .filter(
      ({ requestingAccountId, otherAuthorizedAccounts, unauthorizedAccounts }) =>
        // Ensure no overlap between all account sets
        !otherAuthorizedAccounts.includes(requestingAccountId) &&
        !unauthorizedAccounts.includes(requestingAccountId) &&
        !otherAuthorizedAccounts.some((a) => unauthorizedAccounts.includes(a)),
    )
    .chain(
      ({
        requestingAccountId,
        otherAuthorizedAccounts,
        unauthorizedAccounts,
        ownedResultCount,
        authorizedResultCount,
        unauthorizedResultCount,
      }) => {
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
          .filter(
            ({ ownedIds, authorizedIds, unauthorizedIds }) =>
              // Ensure all analysis IDs are unique across categories
              new Set([...ownedIds, ...authorizedIds, ...unauthorizedIds]).size ===
              ownedIds.length + authorizedIds.length + unauthorizedIds.length,
          )
          .map(({ ownedIds, authorizedIds, unauthorizedIds }) => {
            const ownedResults = ownedIds.map((id) => ({
              analysisId: id,
              accountId: requestingAccountId,
            }));

            const authorizedAccountResults = authorizedIds.map((id, i) => ({
              analysisId: id,
              accountId:
                otherAuthorizedAccounts.length > 0
                  ? otherAuthorizedAccounts[i % otherAuthorizedAccounts.length]
                  : requestingAccountId,
              principalArn: arbitraryPrincipalArn(
                otherAuthorizedAccounts.length > 0
                  ? otherAuthorizedAccounts[i % otherAuthorizedAccounts.length]
                  : requestingAccountId,
              ),
            }));

            const unauthorizedResults = unauthorizedIds.map((id, i) => ({
              analysisId: id,
              accountId: unauthorizedAccounts[i % unauthorizedAccounts.length],
              principalArn: arbitraryPrincipalArn(
                unauthorizedAccounts[i % unauthorizedAccounts.length],
              ),
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
      },
    );
}

/** Builds mock deps from a test scenario. */
function buildDepsFromScenario(scenario: TestScenario): {
  deps: ResultsHandlerDeps;
  statusRecords: Record<string, Record<string, unknown>>;
  s3Results: Record<string, AnalysisResult>;
} {
  const statusRecords: Record<string, Record<string, unknown>> = {};
  const s3Results: Record<string, AnalysisResult> = {};

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
    s3Results[resultLocation] = createMockAnalysisResult(
      analysisId,
      scenario.requestingPrincipalArn,
      accountId,
    );
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

  const authPolicy: AuthorizationPolicy = {
    authorizedAccounts: scenario.authorizedAccounts,
    authorizedRegions: [], // empty means all regions authorized
  };

  const deps = createMockDeps(statusRecords, s3Results, authPolicy);

  return { deps, statusRecords, s3Results };
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: blast-radius-visualizer, Property 19: Result Retrieval Respects Authorization', () => {
  /**
   * **Validates: Requirements 9.7**
   *
   * GET operation: requesting principal can retrieve results they own.
   */
  it('get operation returns results owned by the requesting principal', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTestScenario().filter((s) => s.ownedResults.length > 0),
        async (scenario) => {
          const { deps } = buildDepsFromScenario(scenario);

          // Pick the first owned result
          const ownedResult = scenario.ownedResults[0];

          const input: GetResultInput = {
            operation: 'get',
            analysisId: ownedResult.analysisId,
            requestContext: {
              identity: {
                userArn: scenario.requestingPrincipalArn,
                accountId: scenario.requestingAccountId,
              },
            },
          };

          const result = await handler(input, deps);

          // Should succeed (not an error)
          expect(result).not.toHaveProperty('statusCode');
          const output = result as GetResultOutput;
          expect(output.result).toBeDefined();
          expect(output.result.analysisId).toBe(ownedResult.analysisId);
          expect(output.result.requestingPrincipal).toBe(scenario.requestingPrincipalArn);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 9.7**
   *
   * GET operation: requesting principal can retrieve results for accounts
   * they are authorized to access.
   */
  it('get operation returns results for authorized accounts', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryTestScenario().filter((s) => s.authorizedAccountResults.length > 0),
        async (scenario) => {
          const { deps } = buildDepsFromScenario(scenario);

          // Pick the first authorized account result
          const authorizedResult = scenario.authorizedAccountResults[0];

          const input: GetResultInput = {
            operation: 'get',
            analysisId: authorizedResult.analysisId,
            requestContext: {
              identity: {
                userArn: scenario.requestingPrincipalArn,
                accountId: scenario.requestingAccountId,
              },
            },
          };

          const result = await handler(input, deps);

          // Should succeed (not a 403 error)
          if ('statusCode' in (result as ResultsError)) {
            expect((result as ResultsError).statusCode).not.toBe(403);
          } else {
            const output = result as GetResultOutput;
            expect(output.result).toBeDefined();
            expect(output.result.analysisId).toBe(authorizedResult.analysisId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 9.7**
   *
   * GET operation: requesting principal CANNOT retrieve results for accounts
   * they are NOT authorized to access (and that they don't own).
   */
  it('get operation denies access to results from unauthorized accounts', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryTestScenario(), async (scenario) => {
        const { deps } = buildDepsFromScenario(scenario);

        // Try to access each unauthorized result
        for (const unauthorizedResult of scenario.unauthorizedResults) {
          const input: GetResultInput = {
            operation: 'get',
            analysisId: unauthorizedResult.analysisId,
            requestContext: {
              identity: {
                userArn: scenario.requestingPrincipalArn,
                accountId: scenario.requestingAccountId,
              },
            },
          };

          const result = await handler(input, deps);

          // Should be denied with 403
          expect(result).toHaveProperty('statusCode');
          expect((result as ResultsError).statusCode).toBe(403);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 9.7**
   *
   * LIST operation: returns only results the principal owns or is authorized
   * to access. Never returns unauthorized results.
   */
  it('list operation returns only owned and authorized results, never unauthorized', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryTestScenario(), async (scenario) => {
        const { deps } = buildDepsFromScenario(scenario);

        const input: ListResultsInput = {
          operation: 'list',
          requestContext: {
            identity: {
              userArn: scenario.requestingPrincipalArn,
              accountId: scenario.requestingAccountId,
            },
          },
        };

        const result = await handler(input, deps);

        // Should not be an error
        expect(result).not.toHaveProperty('statusCode');
        const output = result as ListResultsOutput;

        // Collect all returned analysis IDs
        const returnedIds = new Set(output.results.map((r) => r.analysisId));

        // Collect the set of unauthorized analysis IDs
        const unauthorizedIds = new Set(
          scenario.unauthorizedResults.map((r) => r.analysisId),
        );

        // No unauthorized result should appear in the returned list
        for (const id of returnedIds) {
          expect(unauthorizedIds.has(id)).toBe(false);
        }

        // All owned results should appear in the returned list
        for (const owned of scenario.ownedResults) {
          expect(returnedIds.has(owned.analysisId)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 9.7**
   *
   * Unauthenticated requests (no SigV4 context) are rejected.
   */
  it('rejects requests without valid SigV4 authentication context', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryTestScenario(), async (scenario) => {
        const { deps } = buildDepsFromScenario(scenario);

        // Request with no authentication context
        const input: GetResultInput = {
          operation: 'get',
          analysisId:
            scenario.ownedResults.length > 0
              ? scenario.ownedResults[0].analysisId
              : 'any-id',
          requestContext: undefined,
        };

        const result = await handler(input, deps);

        // Should be rejected with 401
        expect(result).toHaveProperty('statusCode');
        expect((result as ResultsError).statusCode).toBe(401);
      }),
      { numRuns: 100 },
    );
  });
});
