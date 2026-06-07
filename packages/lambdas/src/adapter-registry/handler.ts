/**
 * Adapter Registry Lambda handler.
 *
 * Routes incoming changesets to the appropriate Manifest Adapter based on the
 * declared format field. Adapters are registered as Lambda function ARNs in a
 * DynamoDB configuration table. Unknown formats return an error listing all
 * supported format identifiers.
 */

import { DynamoDBClient, ScanCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type {
  AdapterRegistryInput,
  AdapterRegistryOutput,
  AdapterRegistryEntry,
  ResourceChangeManifest,
  AdapterMetadata,
} from '@blast-radius/core';

/** Error response returned when the format is unsupported or invocation fails. */
export interface AdapterRegistryError {
  error: string;
  supportedFormats?: string[];
}

/** Result type from the handler — either a successful output or an error. */
export type AdapterRegistryResult = AdapterRegistryOutput | AdapterRegistryError;

/** Environment variable for the DynamoDB table name. */
const TABLE_NAME = process.env.ADAPTER_REGISTRY_TABLE ?? 'AdapterRegistry';

/**
 * Creates default AWS SDK clients. Exported for testability — tests can
 * override these by providing custom clients via the options parameter.
 */
export interface AdapterRegistryDeps {
  dynamoClient: DynamoDBClient;
  lambdaClient: LambdaClient;
}

function createDefaultDeps(): AdapterRegistryDeps {
  return {
    dynamoClient: new DynamoDBClient({}),
    lambdaClient: new LambdaClient({}),
  };
}

/**
 * Queries DynamoDB for the adapter registered for the given format identifier.
 */
async function getAdapterEntry(
  formatId: string,
  dynamoClient: DynamoDBClient,
): Promise<AdapterRegistryEntry | undefined> {
  const result = await dynamoClient.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        formatId: { S: formatId },
      },
    }),
  );

  if (!result.Item) {
    return undefined;
  }

  const item = unmarshall(result.Item);
  return item as AdapterRegistryEntry;
}

/**
 * Retrieves all supported format identifiers from the registry table.
 */
async function getSupportedFormats(dynamoClient: DynamoDBClient): Promise<string[]> {
  const result = await dynamoClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression: 'formatId',
    }),
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items.map((item) => unmarshall(item).formatId as string).sort();
}

/**
 * Invokes the adapter Lambda and returns the conversion result.
 */
async function invokeAdapter(
  adapterArn: string,
  payload: unknown,
  lambdaClient: LambdaClient,
): Promise<{ manifest: ResourceChangeManifest; durationMs: number; warnings: string[] }> {
  const startTime = Date.now();

  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: adapterArn,
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  );

  const durationMs = Date.now() - startTime;

  if (response.FunctionError) {
    const errorPayload = response.Payload
      ? JSON.parse(new TextDecoder().decode(response.Payload))
      : { message: 'Unknown adapter error' };
    throw new Error(errorPayload.errorMessage ?? errorPayload.message ?? 'Adapter invocation failed');
  }

  if (!response.Payload) {
    throw new Error('Adapter returned empty response');
  }

  const adapterResponse = JSON.parse(new TextDecoder().decode(response.Payload));

  return {
    manifest: adapterResponse.manifest as ResourceChangeManifest,
    durationMs,
    warnings: adapterResponse.warnings ?? [],
  };
}

/**
 * Adapter Registry Lambda handler.
 *
 * 1. Validates the input contains a format and payload.
 * 2. Queries DynamoDB for the adapter registered for that format.
 * 3. If found, invokes the adapter Lambda and returns the result.
 * 4. If not found, returns an error listing all supported formats.
 */
export async function handler(
  event: AdapterRegistryInput,
  deps?: AdapterRegistryDeps,
): Promise<AdapterRegistryResult> {
  const { dynamoClient, lambdaClient } = deps && 'dynamoClient' in deps ? deps : createDefaultDeps();

  // Validate input
  if (!event.format || typeof event.format !== 'string') {
    const supportedFormats = await getSupportedFormats(dynamoClient);
    return {
      error: 'Missing or invalid "format" field. Must be a non-empty string.',
      supportedFormats,
    };
  }

  if (event.payload === undefined || event.payload === null) {
    return {
      error: 'Missing "payload" field. Must contain the native changeset data.',
    };
  }

  // Look up the adapter for this format
  const adapterEntry = await getAdapterEntry(event.format, dynamoClient);

  if (!adapterEntry) {
    const supportedFormats = await getSupportedFormats(dynamoClient);
    return {
      error: `Unsupported format: "${event.format}". Use one of the supported format identifiers.`,
      supportedFormats,
    };
  }

  // Invoke the adapter Lambda
  const { manifest, durationMs, warnings } = await invokeAdapter(
    adapterEntry.adapterLambdaArn,
    event.payload,
    lambdaClient,
  );

  const adapterMetadata: AdapterMetadata = {
    adapterName: adapterEntry.displayName,
    conversionDurationMs: durationMs,
    warnings,
  };

  return {
    manifest,
    adapterMetadata,
  };
}
