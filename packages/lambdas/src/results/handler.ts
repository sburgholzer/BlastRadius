/**
 * Result Retrieval Authorization Lambda handler.
 *
 * Returns only analysis results that the requesting principal is authorized to access.
 * A principal can access results that are:
 * 1. Tagged with their own IAM ARN (they initiated the analysis), OR
 * 2. For accounts the principal is currently authorized to access.
 *
 * Uses DynamoDB for status/metadata lookup and S3 for full result retrieval.
 *
 * Validates: Requirements 9.7
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type {
  AnalysisResult,
  AuthorizationPolicy,
  AuthorizationResolver,
  RequestIdentity,
  SigV4RequestContext,
  ExclusionSummary,
} from '@blast-radius/core';
import {
  extractPrincipalFromSigV4,
  createAuthenticationError,
  scopeScoredResources,
  scopeDependencyGraph,
} from '@blast-radius/core';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Input for retrieving a single analysis result by ID. */
export interface GetResultInput {
  operation: 'get';
  analysisId: string;
  requestContext?: SigV4RequestContext['requestContext'];
}

/** Input for listing analysis results for the requesting principal. */
export interface ListResultsInput {
  operation: 'list';
  requestContext?: SigV4RequestContext['requestContext'];
  limit?: number;
  nextToken?: string;
}

/** Discriminated union of handler inputs. */
export type ResultsInput = GetResultInput | ListResultsInput;

/** Error response returned when the operation fails. */
export interface ResultsError {
  error: string;
  statusCode: number;
}

/** Successful response for a get operation. */
export interface GetResultOutput {
  result: AnalysisResult;
  exclusionSummary: ExclusionSummary;
}

/** Summary entry for list results. */
export interface ResultSummaryEntry {
  analysisId: string;
  status: string;
  sourceFormat: string;
  submittedAt: string;
  completedAt?: string;
  requestingPrincipal: string;
  originatingAccountId: string;
}

/** Successful response for a list operation. */
export interface ListResultsOutput {
  results: ResultSummaryEntry[];
  nextToken?: string;
}

/** Result type from the handler. */
export type ResultsResult = GetResultOutput | ListResultsOutput | ResultsError;

/** Dependencies injectable for testing. */
export interface ResultsHandlerDeps {
  docClient: DynamoDBDocumentClient;
  s3Client: S3Client;
  authResolver: AuthorizationResolver;
}

// ─── Environment Configuration ───────────────────────────────────────────────

const STATUS_TABLE = process.env.STATUS_TABLE ?? 'AnalysisStatus';
const RESULTS_BUCKET = process.env.RESULTS_BUCKET ?? 'blast-radius-results';

// ─── Default Dependencies ────────────────────────────────────────────────────

function createDefaultDeps(): ResultsHandlerDeps {
  const dynamoClient = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const s3Client = new S3Client({});

  // Default authorization resolver that allows access to the principal's own account
  const authResolver: AuthorizationResolver = {
    async resolvePolicy(principalArn: string): Promise<AuthorizationPolicy> {
      // In production, this would query IAM/Organizations for actual permissions.
      // Default: authorize the principal's own account and all regions.
      const accountId = principalArn.split(':')[4] ?? '';
      return {
        authorizedAccounts: accountId ? [accountId] : [],
        authorizedRegions: [],
      };
    },
  };

  return { docClient, s3Client, authResolver };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Results retrieval Lambda handler.
 *
 * Routes to the appropriate operation based on the `operation` field in the input.
 * Enforces authorization: only returns results the requesting principal is allowed to see.
 */
export async function handler(
  event: ResultsInput,
  deps?: ResultsHandlerDeps,
): Promise<ResultsResult> {
  const { docClient, s3Client, authResolver } = deps && 'docClient' in deps ? deps : createDefaultDeps();

  if (!event || typeof event !== 'object') {
    return { error: 'Invalid input: expected an object with an "operation" field', statusCode: 400 };
  }

  if (!('operation' in event) || (event.operation !== 'get' && event.operation !== 'list')) {
    return { error: 'Invalid operation: must be "get" or "list"', statusCode: 400 };
  }

  // Extract requesting principal from SigV4 context
  const sigV4Context: SigV4RequestContext = { requestContext: event.requestContext };
  const identity = extractPrincipalFromSigV4(sigV4Context);

  if (!identity) {
    const authError = createAuthenticationError();
    return { error: authError.message, statusCode: authError.statusCode };
  }

  if (event.operation === 'get') {
    return handleGetResult(event, identity, docClient, s3Client, authResolver);
  }

  return handleListResults(event, identity, docClient, authResolver);
}

// ─── Get Result ──────────────────────────────────────────────────────────────

/**
 * Retrieves a single analysis result by ID.
 *
 * Authorization logic:
 * - If the result is tagged with the requesting principal's ARN → full access
 * - If the result is for an account the principal is authorized to access → scoped access
 * - Otherwise → 403 Forbidden
 */
async function handleGetResult(
  input: GetResultInput,
  identity: RequestIdentity,
  docClient: DynamoDBDocumentClient,
  s3Client: S3Client,
  authResolver: AuthorizationResolver,
): Promise<GetResultOutput | ResultsError> {
  if (!input.analysisId || typeof input.analysisId !== 'string') {
    return { error: 'Missing or invalid "analysisId" field', statusCode: 400 };
  }

  // Look up the analysis status record to get metadata and result location
  const statusResult = await getAnalysisStatus(input.analysisId, docClient);
  if (!statusResult) {
    return { error: `Analysis not found: ${input.analysisId}`, statusCode: 404 };
  }

  // Resolve the principal's current authorization policy
  const policy = await authResolver.resolvePolicy(identity.principalArn);

  // Check if the principal is authorized to access this result
  const resultPrincipal = statusResult.requestingPrincipal as string;
  const resultAccountId = statusResult.originatingAccountId as string;
  const resultLocation = statusResult.resultLocation as string | undefined;

  const isOwner = resultPrincipal === identity.principalArn;
  const isAccountAuthorized =
    policy.authorizedAccounts.length === 0 ||
    policy.authorizedAccounts.includes(resultAccountId);

  if (!isOwner && !isAccountAuthorized) {
    return {
      error: 'Access denied: you are not authorized to view this analysis result',
      statusCode: 403,
    };
  }

  // Retrieve the full result from S3
  if (!resultLocation) {
    return {
      error: 'Analysis result not yet available (analysis may still be in progress)',
      statusCode: 404,
    };
  }

  const analysisResult = await getResultFromS3(resultLocation, s3Client);
  if (!analysisResult) {
    return { error: 'Failed to retrieve analysis result from storage', statusCode: 500 };
  }

  // If the principal is the owner, return full results (they already had access when they ran it)
  if (isOwner) {
    return {
      result: analysisResult,
      exclusionSummary: {
        excludedAccounts: [],
        excludedRegions: [],
        omittedResourceCount: 0,
        reason: 'All resources are within authorized scope.',
      },
    };
  }

  // For non-owners accessing via account authorization, scope the results
  const scopedGraph = scopeDependencyGraph(analysisResult.dependencyGraph, policy);
  const scopedResources = scopeScoredResources(analysisResult.scoredResources, policy);

  const scopedResult: AnalysisResult = {
    ...analysisResult,
    dependencyGraph: scopedGraph.graph,
    scoredResources: scopedResources.resources,
    riskSummary: {
      ...analysisResult.riskSummary,
      totalAffected: scopedResources.resources.length,
      highestScore:
        scopedResources.resources.length > 0
          ? Math.max(...scopedResources.resources.map((r) => r.impactScore))
          : 0,
      critical: scopedResources.resources.filter((r) => r.riskCategory === 'Critical').length,
      high: scopedResources.resources.filter((r) => r.riskCategory === 'High').length,
      medium: scopedResources.resources.filter((r) => r.riskCategory === 'Medium').length,
      low: scopedResources.resources.filter((r) => r.riskCategory === 'Low').length,
    },
  };

  return {
    result: scopedResult,
    exclusionSummary: scopedResources.exclusionSummary,
  };
}

// ─── List Results ────────────────────────────────────────────────────────────

/**
 * Lists analysis results accessible to the requesting principal.
 *
 * Returns results that are either:
 * - Tagged with the principal's own ARN (they initiated the analysis)
 * - For accounts the principal is currently authorized to access
 */
async function handleListResults(
  input: ListResultsInput,
  identity: RequestIdentity,
  docClient: DynamoDBDocumentClient,
  authResolver: AuthorizationResolver,
): Promise<ListResultsOutput | ResultsError> {
  const limit = input.limit ?? 50;

  // Resolve the principal's current authorization policy
  const policy = await authResolver.resolvePolicy(identity.principalArn);

  try {
    // Query for results owned by this principal using a GSI on requestingPrincipal
    const ownedResults = await docClient.send(
      new QueryCommand({
        TableName: STATUS_TABLE,
        IndexName: 'principalIndex',
        KeyConditionExpression: 'requestingPrincipal = :principal',
        ExpressionAttributeValues: {
          ':principal': identity.principalArn,
        },
        Limit: limit,
        ...(input.nextToken ? { ExclusiveStartKey: JSON.parse(input.nextToken) } : {}),
      }),
    );

    const entries: ResultSummaryEntry[] = [];

    for (const item of ownedResults.Items ?? []) {
      entries.push(mapToSummaryEntry(item));
    }

    // If the principal has access to additional accounts, query for those too
    if (policy.authorizedAccounts.length > 0) {
      for (const accountId of policy.authorizedAccounts) {
        // Skip the principal's own account (already covered by owned results)
        if (accountId === identity.accountId) continue;

        try {
          const accountResults = await docClient.send(
            new QueryCommand({
              TableName: STATUS_TABLE,
              IndexName: 'accountIndex',
              KeyConditionExpression: 'originatingAccountId = :accountId',
              ExpressionAttributeValues: {
                ':accountId': accountId,
              },
              Limit: limit,
            }),
          );

          for (const item of accountResults.Items ?? []) {
            // Avoid duplicates (in case the principal also owns results in this account)
            if (!entries.some((e) => e.analysisId === (item.analysisId as string))) {
              entries.push(mapToSummaryEntry(item));
            }
          }
        } catch {
          // Continue if a particular account query fails
        }
      }
    }

    // Sort by submittedAt descending (most recent first)
    entries.sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));

    // Apply limit
    const limited = entries.slice(0, limit);

    const nextToken = ownedResults.LastEvaluatedKey
      ? JSON.stringify(ownedResults.LastEvaluatedKey)
      : undefined;

    return {
      results: limited,
      nextToken,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error during results listing';
    return { error: message, statusCode: 500 };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Retrieves the analysis status record from DynamoDB. */
async function getAnalysisStatus(
  analysisId: string,
  docClient: DynamoDBDocumentClient,
): Promise<Record<string, unknown> | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: STATUS_TABLE,
        Key: { analysisId },
        ConsistentRead: true,
      }),
    );
    return (result.Item as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

/** Retrieves the full analysis result from S3. */
async function getResultFromS3(
  resultLocation: string,
  s3Client: S3Client,
): Promise<AnalysisResult | null> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: RESULTS_BUCKET,
        Key: resultLocation,
      }),
    );

    const body = await response.Body?.transformToString();
    if (!body) return null;

    return JSON.parse(body) as AnalysisResult;
  } catch {
    return null;
  }
}

/** Maps a DynamoDB item to a ResultSummaryEntry. */
function mapToSummaryEntry(item: Record<string, unknown>): ResultSummaryEntry {
  return {
    analysisId: item.analysisId as string,
    status: item.status as string,
    sourceFormat: (item.sourceFormat as string) ?? 'unknown',
    submittedAt: (item.startedAt as string) ?? '',
    completedAt: item.completedAt as string | undefined,
    requestingPrincipal: item.requestingPrincipal as string,
    originatingAccountId: item.originatingAccountId as string,
  };
}
