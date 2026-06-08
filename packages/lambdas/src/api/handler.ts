import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

interface APIGatewayProxyEvent {
  httpMethod: string;
  path: string;
  pathParameters?: Record<string, string> | null;
  queryStringParameters?: Record<string, string> | null;
  body?: string | null;
  headers?: Record<string, string>;
}

interface APIGatewayProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN ?? '';
const STATUS_TABLE = process.env.STATUS_TABLE ?? 'BlastRadius-AnalysisStatus';
const ADAPTER_REGISTRY_TABLE = process.env.ADAPTER_REGISTRY_TABLE ?? 'BlastRadius-AdapterRegistry';
const RESULTS_BUCKET = process.env.RESULTS_BUCKET ?? '';

const sfnClient = new SFNClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({});

function corsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
}

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { httpMethod, path } = event;

  // Handle CORS preflight
  if (httpMethod === 'OPTIONS') {
    return jsonResponse(200, {});
  }

  try {
    // Normalize path — API Gateway may include or exclude the stage prefix
    const normalizedPath = path.replace(/^\/v1/, '') || '/';

    // Route: GET /formats
    if (httpMethod === 'GET' && normalizedPath === '/formats') {
      return await handleGetFormats();
    }

    // Route: GET /analyses (list all)
    if (httpMethod === 'GET' && normalizedPath === '/analyses') {
      return await handleListAnalyses();
    }

    // Route: POST /analyze
    if (httpMethod === 'POST' && normalizedPath === '/analyze') {
      return await handlePostAnalyze(event);
    }

    // Route: GET /analyze/{analysisId}/export
    if (httpMethod === 'GET' && normalizedPath.match(/^\/analyze\/[^/]+\/export$/)) {
      const analysisId = event.pathParameters?.analysisId ?? normalizedPath.split('/')[2];
      return await handleGetAnalysis(analysisId);
    }

    // Route: GET /analyze/{analysisId}
    if (httpMethod === 'GET' && normalizedPath.match(/^\/analyze\/[^/]+$/)) {
      const analysisId = event.pathParameters?.analysisId ?? normalizedPath.split('/')[2];
      return await handleGetAnalysis(analysisId);
    }

    return jsonResponse(404, { error: `Not found: ${httpMethod} ${path}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('API handler error:', err);
    return jsonResponse(500, { error: message });
  }
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

async function handleGetFormats(): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new ScanCommand({
    TableName: ADAPTER_REGISTRY_TABLE,
  }));

  const formats = (result.Items ?? []).map(item => ({
    formatId: item.formatId,
    displayName: item.displayName ?? item.formatId,
  }));

  // Always include the built-in formats even if table is empty
  const builtIn = [
    { formatId: 'canonical', displayName: 'Canonical Manifest' },
    { formatId: 'cloudformation', displayName: 'CloudFormation Changeset' },
    { formatId: 'terraform-plan', displayName: 'Terraform Plan JSON' },
    { formatId: 'cdk', displayName: 'CDK Cloud Assembly Diff' },
  ];

  // Merge: table entries override built-in
  const formatMap = new Map(builtIn.map(f => [f.formatId, f]));
  for (const f of formats) {
    formatMap.set(f.formatId as string, f as { formatId: string; displayName: string });
  }

  return jsonResponse(200, Array.from(formatMap.values()));
}

async function handleListAnalyses(): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new ScanCommand({
    TableName: STATUS_TABLE,
    Limit: 50,
  }));

  const analyses = (result.Items ?? []).map(item => ({
    analysisId: item.analysisId,
    status: item.status ?? 'unknown',
    currentStage: item.currentStage ?? '',
    progressPercentage: item.progressPercentage ?? 0,
    startedAt: item.startedAt ?? item.updatedAt ?? '',
    updatedAt: item.updatedAt ?? '',
    requestingPrincipal: item.requestingPrincipal ?? '',
    originatingAccountId: item.originatingAccountId ?? '',
  }));

  return jsonResponse(200, analyses);
}

async function handlePostAnalyze(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!event.body) {
    return jsonResponse(400, { error: 'Request body is required' });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON in request body' });
  }

  const analysisId = randomUUID();
  const format = (body.format as string) ?? 'canonical';
  const manifest = body.manifest;
  const options = (body.options as Record<string, unknown>) ?? {};

  // Write initial status to DynamoDB
  const now = new Date().toISOString();
  await docClient.send(new PutCommand({
    TableName: STATUS_TABLE,
    Item: {
      analysisId,
      status: 'running',
      currentStage: 'Ingestion',
      progressPercentage: 0,
      startedAt: now,
      updatedAt: now,
      requestingPrincipal: 'demo-user',
      originatingAccountId: '136347816899',
    },
  }));

  // Start Step Functions execution
  await sfnClient.send(new StartExecutionCommand({
    stateMachineArn: STATE_MACHINE_ARN,
    name: analysisId,
    input: JSON.stringify({
      analysisId,
      sourceFormat: format,
      manifest,
      options,
      requestingPrincipal: 'demo-user',
      originatingAccountId: '136347816899',
    }),
  }));

  return jsonResponse(202, {
    analysisId,
    status: 'running',
  });
}

async function handleGetAnalysis(analysisId: string): Promise<APIGatewayProxyResult> {
  // Get status from DynamoDB
  const statusResult = await docClient.send(new GetCommand({
    TableName: STATUS_TABLE,
    Key: { analysisId },
  }));

  if (!statusResult.Item) {
    return jsonResponse(404, { error: `Analysis not found: ${analysisId}` });
  }

  const item = statusResult.Item;

  // If completed and has a result location, fetch from S3
  if (item.status === 'completed' && item.resultLocation) {
    try {
      const s3Result = await s3Client.send(new GetObjectCommand({
        Bucket: RESULTS_BUCKET,
        Key: item.resultLocation as string,
      }));
      const responseBody = await s3Result.Body?.transformToString();
      if (responseBody) {
        const vizResult = JSON.parse(responseBody);

        // Map visualization format to the shape the frontend expects
        const scoredResources = (vizResult.nodes ?? [])
          .filter((n: { isDirectChange?: boolean }) => !n.isDirectChange)
          .map((n: { id: string; resourceType: string; provider: string; region: string; accountId: string; impactScore: number | null; riskCategory: string | null; dependencyChain: string[] }) => ({
            resourceId: n.id,
            resourceType: n.resourceType,
            provider: n.provider,
            region: n.region,
            accountId: n.accountId,
            impactScore: n.impactScore ?? 0,
            riskCategory: n.riskCategory ?? 'Low',
            dependencyChain: n.dependencyChain ?? [],
            dependencyDepth: (n.dependencyChain?.length ?? 1) - 1 || 1,
            criticalityClassification: n.riskCategory ?? 'Low',
            changeTypeSeverity: 50,
          }));

        const graphNodes = (vizResult.nodes ?? []).map((n: { id: string; resourceType: string; provider: string; region: string; accountId: string; isDirectChange: boolean }) => ({
            resourceId: n.id,
            resourceType: n.resourceType,
            provider: n.provider,
            region: n.region,
            accountId: n.accountId,
            isDirectChange: n.isDirectChange ?? false,
            dependencyCoverage: 'full',
          }));

        const nodeIds = new Set(graphNodes.map((n: { resourceId: string }) => n.resourceId));

        const graphEdges = (vizResult.edges ?? [])
          .map((e: { source: string; target: string; relationshipType: string; depth: number }) => ({
            sourceId: e.source,
            targetId: e.target,
            relationshipType: e.relationshipType,
            depth: e.depth,
          }))
          .filter((e: { sourceId: string; targetId: string }) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId));

        // Remove orphan nodes (no edges connecting them)
        const connectedNodeIds = new Set<string>();
        for (const e of graphEdges) {
          connectedNodeIds.add(e.sourceId);
          connectedNodeIds.add(e.targetId);
        }
        // Keep direct changes even if orphaned (they're the root cause)
        const filteredNodes = graphNodes.filter(
          (n: { resourceId: string; isDirectChange: boolean }) =>
            connectedNodeIds.has(n.resourceId) || n.isDirectChange
        );

        const dependencyGraph = {
          nodes: filteredNodes,
          edges: graphEdges,
        };

        return jsonResponse(200, {
          analysisId,
          status: 'completed',
          sourceFormat: vizResult.metadata?.sourceFormat ?? '',
          submittedAt: item.startedAt ?? '',
          completedAt: item.updatedAt ?? '',
          requestingPrincipal: item.requestingPrincipal ?? '',
          originatingAccountId: item.originatingAccountId ?? '',
          riskSummary: vizResult.riskSummary,
          scoredResources,
          dependencyGraph,
          ...(vizResult.naturalLanguageSummary ? { naturalLanguageSummary: vizResult.naturalLanguageSummary } : {}),
          ...(vizResult.recommendDeploy !== undefined ? { recommendDeploy: vizResult.recommendDeploy } : {}),
          ...(vizResult.confidence ? { confidence: vizResult.confidence } : {}),
        });
      }
    } catch {
      // Fall through to return status only
    }
  }

  // Return status info
  return jsonResponse(200, {
    analysisId,
    status: item.status,
    currentStage: item.currentStage,
    progressPercentage: item.progressPercentage,
    startedAt: item.startedAt,
    updatedAt: item.updatedAt,
    requestingPrincipal: item.requestingPrincipal,
    originatingAccountId: item.originatingAccountId,
  });
}
