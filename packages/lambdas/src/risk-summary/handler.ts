/**
 * Risk Summary Generator Lambda handler.
 *
 * Invokes Amazon Bedrock InvokeModel API to generate a natural language
 * summary of the blast radius analysis. Selects the top 3 highest-scoring
 * resources (or all if fewer than 3) for summary input.
 *
 * - Summary is limited to 500 words maximum.
 * - 15-second timeout; on failure returns gracefully without blocking results.
 * - Feature flag controls enablement — when disabled, returns immediately.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  ScoredResource,
  RiskSummary,
  DependencyGraph,
} from '@blast-radius/core';

export interface SummaryInput {
  scoredResources: ScoredResource[];
  riskSummary: RiskSummary;
  dependencyGraph: DependencyGraph;
  /** Feature flag: when false, summary generation is skipped. */
  enableSummary?: boolean;
}

export interface SummaryOutput {
  /** The generated natural language summary (max 500 words), or undefined if skipped/failed. */
  summary?: string;
  /** Duration of the generation call in milliseconds. */
  generationDurationMs: number;
  /** Whether the summary was skipped due to feature flag being disabled. */
  skipped: boolean;
  /** Error message if generation failed. */
  error?: string;
}

/** Default timeout for Bedrock invocation in milliseconds. */
const BEDROCK_TIMEOUT_MS = 15_000;

/** Maximum number of top-risk resources to include in the prompt. */
const TOP_K_RESOURCES = 3;

/** The Bedrock model ID to use for summary generation. */
const DEFAULT_MODEL_ID = 'anthropic.claude-haiku-4-5-20251001-v1:0';

/**
 * Select the top K highest-scoring resources for summary input.
 * Returns at most `k` resources sorted by impactScore descending.
 * If fewer than `k` resources exist, returns all of them.
 */
export function selectTopResources(
  scoredResources: ScoredResource[],
  k: number = TOP_K_RESOURCES,
): ScoredResource[] {
  return [...scoredResources]
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, k);
}

/**
 * Build the structured prompt for Bedrock to generate a risk summary.
 */
export function buildPrompt(
  topResources: ScoredResource[],
  riskSummary: RiskSummary,
): string {
  const resourceDescriptions = topResources
    .map(
      (r, i) =>
        `${i + 1}. Resource: ${r.resourceType} (${r.resourceId})\n` +
        `   Region: ${r.region}, Account: ${r.accountId}\n` +
        `   Impact Score: ${r.impactScore}/100 (${r.riskCategory} risk)\n` +
        `   Dependency Depth: ${r.dependencyDepth}\n` +
        `   Criticality: ${r.criticalityClassification}\n` +
        `   Dependency Chain: ${r.dependencyChain.join(' → ')}`,
    )
    .join('\n\n');

  return (
    `You are a cloud infrastructure risk analyst. Generate a concise, plain-English summary ` +
    `of the blast radius analysis results below. The summary must not exceed 500 words.\n\n` +
    `For each high-risk resource, describe:\n` +
    `- The affected service and why it is at risk\n` +
    `- The reason for the risk (dependency chain, criticality)\n` +
    `- A suggested mitigation action\n\n` +
    `Overall Risk Summary:\n` +
    `- Total affected resources: ${riskSummary.totalAffected}\n` +
    `- Critical: ${riskSummary.critical}, High: ${riskSummary.high}, ` +
    `Medium: ${riskSummary.medium}, Low: ${riskSummary.low}\n` +
    `- Highest impact score: ${riskSummary.highestScore}/100\n\n` +
    `Top ${topResources.length} Highest-Risk Resources:\n\n` +
    `${resourceDescriptions}\n\n` +
    `Provide the summary in plain language suitable for a team lead reviewing a deployment. ` +
    `Focus on actionable insights and keep it under 500 words.`
  );
}

/**
 * Create a Bedrock runtime client with the configured timeout.
 */
function createBedrockClient(timeoutMs: number = BEDROCK_TIMEOUT_MS): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    requestHandler: {
      requestTimeout: timeoutMs,
    } as never,
  });
}

/**
 * Invoke Bedrock to generate the summary text.
 * Throws on failure (caller handles graceful degradation).
 */
async function invokeBedrockModel(
  client: BedrockRuntimeClient,
  prompt: string,
  modelId: string,
): Promise<string> {
  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(body),
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  // Extract text from Claude response format
  const text: string =
    responseBody.content?.[0]?.text ?? responseBody.completion ?? '';

  return text;
}

/**
 * Enforce the 500-word limit on the generated summary.
 * If the summary exceeds 500 words, truncate at the last complete sentence
 * within the limit.
 */
export function enforceWordLimit(text: string, maxWords: number = 500): string {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= maxWords) {
    return text.trim();
  }

  // Truncate to maxWords and find last sentence boundary
  const truncated = words.slice(0, maxWords).join(' ');
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('!'),
    truncated.lastIndexOf('?'),
  );

  if (lastSentenceEnd > 0) {
    return truncated.slice(0, lastSentenceEnd + 1);
  }

  return truncated;
}

/**
 * Risk Summary Generator Lambda handler.
 *
 * Generates a natural language summary of blast radius analysis using Amazon Bedrock.
 * Returns gracefully on failure without blocking the analysis pipeline.
 */
export async function handler(input: SummaryInput): Promise<SummaryOutput> {
  const startTime = Date.now();

  // Check feature flag — if disabled, skip summary generation entirely
  const enableSummary = input.enableSummary ?? isFeatureEnabled();
  if (!enableSummary) {
    return {
      summary: undefined,
      generationDurationMs: Date.now() - startTime,
      skipped: true,
    };
  }

  // If no scored resources, return empty summary
  if (input.scoredResources.length === 0) {
    return {
      summary: 'No resources were affected by the proposed changes. The blast radius is empty.',
      generationDurationMs: Date.now() - startTime,
      skipped: false,
    };
  }

  try {
    // Select top 3 highest-scoring resources (or all if fewer than 3)
    const topResources = selectTopResources(input.scoredResources, TOP_K_RESOURCES);

    // Build the prompt
    const prompt = buildPrompt(topResources, input.riskSummary);

    // Invoke Bedrock with timeout
    const modelId = process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;
    const client = createBedrockClient(BEDROCK_TIMEOUT_MS);

    const summaryText = await Promise.race([
      invokeBedrockModel(client, prompt, modelId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Bedrock invocation timed out after 15 seconds')), BEDROCK_TIMEOUT_MS),
      ),
    ]);

    // Enforce 500-word limit; treat empty response as failure
    const summary = enforceWordLimit(summaryText);
    if (!summary) {
      return {
        summary: undefined,
        generationDurationMs: Date.now() - startTime,
        skipped: false,
        error: 'Bedrock returned an empty response',
      };
    }

    return {
      summary,
      generationDurationMs: Date.now() - startTime,
      skipped: false,
    };
  } catch (error: unknown) {
    // Graceful degradation: return without summary on any failure
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error during summary generation';

    return {
      summary: undefined,
      generationDurationMs: Date.now() - startTime,
      skipped: false,
      error: errorMessage,
    };
  }
}

/**
 * Check if the Bedrock summary feature is enabled via environment variable.
 * Defaults to false (disabled) if not set.
 */
function isFeatureEnabled(): boolean {
  const flag = process.env.ENABLE_BEDROCK_SUMMARY;
  return flag === 'true' || flag === '1';
}
