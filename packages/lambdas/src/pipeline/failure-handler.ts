/**
 * Pipeline Failure Handler Lambda.
 *
 * Invoked by the Step Functions state machine when a pipeline stage fails.
 * Stores partial results in S3 under the same analysis ID, records which stages
 * completed successfully and which stage failed with its error category, and
 * updates the analysis status to "failed" with error details.
 *
 * Requirements: 5.3, 5.7
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { AnalysisResult, AnalysisErrorDetails } from '@blast-radius/core';

/** Known error categories for pipeline failures. */
export type ErrorCategory =
  | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_NOT_FOUND'
  | 'SERVICE_THROTTLING'
  | 'TRANSIENT_NETWORK'
  | 'INTERNAL_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN';

/** Input event received from Step Functions on pipeline failure. */
export interface FailureHandlerInput {
  analysisId: string;
  requestingPrincipal: string;
  originatingAccountId: string;
  sourceFormat: string;
  submittedAt: string;
  completedStages: string[];
  failedStage: string;
  error: {
    message: string;
    category: ErrorCategory;
  };
  /** Partial results accumulated before the failure. */
  partialResults?: {
    manifest?: AnalysisResult['manifest'];
    dependencyGraph?: AnalysisResult['dependencyGraph'];
    scoredResources?: AnalysisResult['scoredResources'];
    riskSummary?: AnalysisResult['riskSummary'];
    stageDurations?: Record<string, number>;
  };
}

/** Successful output from the failure handler. */
export interface FailureHandlerOutput {
  success: true;
  analysisId: string;
  resultLocation: string;
  failedStage: string;
  errorCategory: ErrorCategory;
}

/** Error output from the failure handler. */
export interface FailureHandlerError {
  error: string;
  statusCode: number;
}

/** Result type from the handler. */
export type FailureHandlerResult = FailureHandlerOutput | FailureHandlerError;

/** Dependencies injectable for testing. */
export interface FailureHandlerDeps {
  s3Client: S3Client;
  docClient: DynamoDBDocumentClient;
}

/** Environment variables. */
const RESULTS_BUCKET = process.env.RESULTS_BUCKET ?? 'blast-radius-results';
const STATUS_TABLE = process.env.STATUS_TABLE ?? 'AnalysisStatus';

function createDefaultDeps(): FailureHandlerDeps {
  const s3Client = new S3Client({});
  const dynamoClient = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return { s3Client, docClient };
}

/**
 * Classifies an error message into a known error category if one is not provided.
 */
function classifyError(message: string): ErrorCategory {
  const lower = message.toLowerCase();
  if (lower.includes('validation') || lower.includes('invalid') || lower.includes('schema')) {
    return 'VALIDATION_ERROR';
  }
  if (lower.includes('permission') || lower.includes('access denied') || lower.includes('unauthorized')) {
    return 'PERMISSION_DENIED';
  }
  if (lower.includes('not found') || lower.includes('does not exist')) {
    return 'RESOURCE_NOT_FOUND';
  }
  if (lower.includes('throttl') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'SERVICE_THROTTLING';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'TIMEOUT';
  }
  if (lower.includes('network') || lower.includes('connection') || lower.includes('econnreset')) {
    return 'TRANSIENT_NETWORK';
  }
  return 'UNKNOWN';
}

/**
 * Determines if an error category is non-retryable.
 * Non-retryable: VALIDATION_ERROR, PERMISSION_DENIED, RESOURCE_NOT_FOUND
 */
export function isNonRetryable(category: ErrorCategory): boolean {
  return ['VALIDATION_ERROR', 'PERMISSION_DENIED', 'RESOURCE_NOT_FOUND'].includes(category);
}

/**
 * Stores partial analysis results in S3.
 */
async function storePartialResults(
  input: FailureHandlerInput,
  s3Client: S3Client,
): Promise<string> {
  const errorDetails: AnalysisErrorDetails = {
    stage: input.failedStage,
    errorCategory: input.error.category,
    message: input.error.message,
  };

  const partialResult: Partial<AnalysisResult> & Pick<AnalysisResult, 'analysisId' | 'status' | 'requestingPrincipal' | 'originatingAccountId' | 'sourceFormat' | 'submittedAt' | 'completedStages' | 'failedStage' | 'errorDetails'> = {
    analysisId: input.analysisId,
    status: 'failed',
    requestingPrincipal: input.requestingPrincipal,
    originatingAccountId: input.originatingAccountId,
    sourceFormat: input.sourceFormat,
    submittedAt: input.submittedAt,
    completedAt: new Date().toISOString(),
    completedStages: input.completedStages,
    failedStage: input.failedStage,
    errorDetails,
    ...(input.partialResults?.manifest && { manifest: input.partialResults.manifest }),
    ...(input.partialResults?.dependencyGraph && { dependencyGraph: input.partialResults.dependencyGraph }),
    ...(input.partialResults?.scoredResources && { scoredResources: input.partialResults.scoredResources }),
    ...(input.partialResults?.riskSummary && { riskSummary: input.partialResults.riskSummary }),
    stageDurations: input.partialResults?.stageDurations ?? {},
  };

  const key = `results/${input.analysisId}/analysis-result.json`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: RESULTS_BUCKET,
      Key: key,
      Body: JSON.stringify(partialResult, null, 2),
      ContentType: 'application/json',
    }),
  );

  return `s3://${RESULTS_BUCKET}/${key}`;
}

/**
 * Updates the analysis status in DynamoDB to "failed" with error details.
 */
async function updateStatusToFailed(
  input: FailureHandlerInput,
  resultLocation: string,
  docClient: DynamoDBDocumentClient,
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: STATUS_TABLE,
      Key: { analysisId: input.analysisId },
      UpdateExpression: `
        SET #status = :status,
            currentStage = :failedStage,
            progressPercentage = :progress,
            updatedAt = :updatedAt,
            resultLocation = :resultLocation,
            errorCategory = :errorCategory,
            errorMessage = :errorMessage
      `.trim(),
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': 'failed',
        ':failedStage': input.failedStage,
        ':progress': 100,
        ':updatedAt': new Date().toISOString(),
        ':resultLocation': resultLocation,
        ':errorCategory': input.error.category,
        ':errorMessage': input.error.message,
      },
    }),
  );
}

/**
 * Pipeline Failure Handler Lambda entry point.
 *
 * Stores partial results in S3 and updates the analysis status to "failed".
 */
export async function handler(
  event: FailureHandlerInput,
  deps?: FailureHandlerDeps,
): Promise<FailureHandlerResult> {
  const { s3Client, docClient } = deps ?? createDefaultDeps();

  // Validate required input fields
  if (!event || typeof event !== 'object') {
    return { error: 'Invalid input: expected an object', statusCode: 400 };
  }
  if (!event.analysisId || typeof event.analysisId !== 'string') {
    return { error: 'Missing or invalid "analysisId" field', statusCode: 400 };
  }
  if (!event.requestingPrincipal || typeof event.requestingPrincipal !== 'string') {
    return { error: 'Missing or invalid "requestingPrincipal" field', statusCode: 400 };
  }
  if (!event.originatingAccountId || typeof event.originatingAccountId !== 'string') {
    return { error: 'Missing or invalid "originatingAccountId" field', statusCode: 400 };
  }
  if (!event.failedStage || typeof event.failedStage !== 'string') {
    return { error: 'Missing or invalid "failedStage" field', statusCode: 400 };
  }
  if (!event.error || typeof event.error !== 'object' || !event.error.message) {
    return { error: 'Missing or invalid "error" field', statusCode: 400 };
  }
  if (!Array.isArray(event.completedStages)) {
    return { error: 'Missing or invalid "completedStages" field: must be an array', statusCode: 400 };
  }

  // Ensure error category is set (classify from message if not provided)
  const errorCategory: ErrorCategory = event.error.category || classifyError(event.error.message);
  const normalizedInput: FailureHandlerInput = {
    ...event,
    error: { ...event.error, category: errorCategory },
  };

  try {
    // Store partial results in S3
    const resultLocation = await storePartialResults(normalizedInput, s3Client);

    // Update DynamoDB status to "failed"
    await updateStatusToFailed(normalizedInput, resultLocation, docClient);

    return {
      success: true,
      analysisId: event.analysisId,
      resultLocation,
      failedStage: event.failedStage,
      errorCategory,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error in failure handler';
    return { error: `Failed to store failure results: ${message}`, statusCode: 500 };
  }
}
