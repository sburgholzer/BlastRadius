/**
 * Analysis Status Tracking Lambda handler.
 *
 * Supports two operations:
 * 1. **update** — Called by the pipeline to store/update the current analysis status
 *    in DynamoDB (stage, progress, elapsed time). Tags results with the requesting
 *    principal's IAM ARN and originating account ID.
 * 2. **get** — Called by the API to retrieve the current status for a given analysis ID.
 *    Returns the status within 2 seconds (Requirement 5.5).
 *
 * Table name is read from the STATUS_TABLE environment variable.
 *
 * Requirements: 5.5, 5.6, 9.6
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { AnalysisStatus } from '@blast-radius/core';

/** Input for updating analysis status (called by the pipeline). */
export interface UpdateStatusInput {
  operation: 'update';
  analysisId: string;
  requestingPrincipal: string;
  originatingAccountId: string;
  status: 'running' | 'completed' | 'failed';
  currentStage: string;
  progressPercentage: number;
  resultLocation?: string;
}

/** Input for retrieving analysis status (called by the API). */
export interface GetStatusInput {
  operation: 'get';
  analysisId: string;
}

/** Discriminated union of handler inputs. */
export type StatusInput = UpdateStatusInput | GetStatusInput;

/** Error response returned when the operation fails. */
export interface StatusError {
  error: string;
  statusCode: number;
}

/** Successful response for a get operation. */
export interface GetStatusOutput {
  status: AnalysisStatus;
}

/** Successful response for an update operation. */
export interface UpdateStatusOutput {
  success: true;
  analysisId: string;
  updatedAt: string;
}

/** Result type from the handler. */
export type StatusResult = GetStatusOutput | UpdateStatusOutput | StatusError;

/** Dependencies injectable for testing. */
export interface StatusHandlerDeps {
  docClient: DynamoDBDocumentClient;
}

/** Environment variable for the DynamoDB status table name. */
const TABLE_NAME = process.env.STATUS_TABLE ?? 'AnalysisStatus';

function createDefaultDeps(): StatusHandlerDeps {
  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return { docClient };
}

/**
 * Handles the 'update' operation — stores or updates the analysis status record.
 *
 * On first call (status = 'running', progressPercentage = 0), creates the record
 * with startedAt timestamp. Subsequent calls update currentStage, progressPercentage,
 * elapsedTimeMs, and updatedAt.
 *
 * Tags results with requestingPrincipal and originatingAccountId (Requirement 9.6).
 */
async function handleUpdate(
  input: UpdateStatusInput,
  docClient: DynamoDBDocumentClient,
): Promise<UpdateStatusOutput | StatusError> {
  const now = new Date().toISOString();

  // Use UpdateCommand with conditional expressions to handle both create and update
  // If the item doesn't exist yet, SET startedAt; otherwise just update fields.
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { analysisId: input.analysisId },
        UpdateExpression: `
          SET #status = :status,
              currentStage = :currentStage,
              progressPercentage = :progressPercentage,
              updatedAt = :updatedAt,
              requestingPrincipal = :requestingPrincipal,
              originatingAccountId = :originatingAccountId
              ${input.resultLocation ? ', resultLocation = :resultLocation' : ''}
              ${input.status === 'running' ? ', startedAt = if_not_exists(startedAt, :updatedAt)' : ''}
        `.trim(),
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': input.status,
          ':currentStage': input.currentStage,
          ':progressPercentage': input.progressPercentage,
          ':updatedAt': now,
          ':requestingPrincipal': input.requestingPrincipal,
          ':originatingAccountId': input.originatingAccountId,
          ...(input.resultLocation ? { ':resultLocation': input.resultLocation } : {}),
        },
      }),
    );

    return {
      success: true,
      analysisId: input.analysisId,
      updatedAt: now,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error during status update';
    return {
      error: message,
      statusCode: 500,
    };
  }
}

/**
 * Handles the 'get' operation — retrieves the current status for a given analysis ID.
 * Returns the status within 2 seconds (Requirement 5.5).
 */
async function handleGet(
  input: GetStatusInput,
  docClient: DynamoDBDocumentClient,
): Promise<GetStatusOutput | StatusError> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { analysisId: input.analysisId },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      return {
        error: `Analysis not found: ${input.analysisId}`,
        statusCode: 404,
      };
    }

    const item = result.Item as Record<string, unknown>;

    const status: AnalysisStatus = {
      analysisId: item.analysisId as string,
      requestingPrincipal: item.requestingPrincipal as string,
      originatingAccountId: item.originatingAccountId as string,
      status: item.status as 'running' | 'completed' | 'failed',
      currentStage: item.currentStage as string,
      progressPercentage: item.progressPercentage as number,
      elapsedTimeMs: computeElapsedTimeMs(item.startedAt as string | undefined),
      startedAt: item.startedAt as string,
      updatedAt: item.updatedAt as string,
      ...(item.resultLocation ? { resultLocation: item.resultLocation as string } : {}),
    };

    return { status };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error during status retrieval';
    return {
      error: message,
      statusCode: 500,
    };
  }
}

/**
 * Computes elapsed time in milliseconds from the startedAt timestamp to now.
 */
function computeElapsedTimeMs(startedAt: string | undefined): number {
  if (!startedAt) {
    return 0;
  }
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  return Math.max(0, now - start);
}

/**
 * Analysis Status Lambda handler.
 *
 * Routes to the appropriate operation based on the `operation` field in the input.
 */
export async function handler(event: StatusInput, deps?: StatusHandlerDeps): Promise<StatusResult> {
  const { docClient } = deps ?? createDefaultDeps();

  if (!event || typeof event !== 'object') {
    return { error: 'Invalid input: expected an object with an "operation" field', statusCode: 400 };
  }

  if (!('operation' in event) || (event.operation !== 'get' && event.operation !== 'update')) {
    return { error: 'Invalid operation: must be "get" or "update"', statusCode: 400 };
  }

  if (!event.analysisId || typeof event.analysisId !== 'string') {
    return { error: 'Missing or invalid "analysisId" field', statusCode: 400 };
  }

  if (event.operation === 'get') {
    return handleGet(event, docClient);
  }

  // Validate update-specific fields
  const updateInput = event as UpdateStatusInput;
  if (!updateInput.requestingPrincipal || typeof updateInput.requestingPrincipal !== 'string') {
    return { error: 'Missing or invalid "requestingPrincipal" field', statusCode: 400 };
  }
  if (!updateInput.originatingAccountId || typeof updateInput.originatingAccountId !== 'string') {
    return { error: 'Missing or invalid "originatingAccountId" field', statusCode: 400 };
  }
  if (!updateInput.currentStage || typeof updateInput.currentStage !== 'string') {
    return { error: 'Missing or invalid "currentStage" field', statusCode: 400 };
  }
  if (typeof updateInput.progressPercentage !== 'number' || updateInput.progressPercentage < 0 || updateInput.progressPercentage > 100) {
    return { error: 'Invalid "progressPercentage": must be a number between 0 and 100', statusCode: 400 };
  }
  if (!updateInput.status || !['running', 'completed', 'failed'].includes(updateInput.status)) {
    return { error: 'Invalid "status": must be "running", "completed", or "failed"', statusCode: 400 };
  }

  return handleUpdate(updateInput, docClient);
}
