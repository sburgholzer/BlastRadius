/**
 * CDK Diff command — analyzes a CDK project's pending changes against
 * a deployed stack using Blast Radius.
 *
 * Workflow:
 *   1. Synthesize the CDK app (runs `cdk synth` or uses existing cdk.out)
 *   2. Create a read-only CloudFormation changeset against the deployed stack
 *   3. Describe the changeset to get structured change data
 *   4. Delete the changeset (never executed)
 *   5. Submit the changeset as format "cloudformation" to the Blast Radius API
 *
 * Usage:
 *   blast-radius cdk-diff --stack MyStack
 *   blast-radius cdk-diff --stack MyStack --app "npx ts-node bin/app.ts"
 *   blast-radius cdk-diff --stack MyStack --threshold 75 --ci
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CliOutput, ApiClient } from './index.js';
import { formatError, formatVerdict } from './index.js';
import { evaluateThreshold, validateThreshold } from '@blast-radius/core';
import type { AnalysisResult } from '@blast-radius/core';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CdkDiffOptions {
  /** CloudFormation stack name to diff against */
  stack: string;
  /** CDK app command (e.g., "npx ts-node bin/app.ts"). If omitted, uses cdk.json in cwd. */
  app?: string;
  /** AWS region */
  region?: string;
  /** AWS profile */
  profile?: string;
  /** Risk threshold (0-100) */
  threshold?: number;
  /** Enable AI summary generation. Default: true */
  summary?: boolean;
  /** Fail if AI recommends against deployment */
  aiGate?: boolean;
  /** Machine-readable output */
  ci?: boolean;
}

export interface CloudFormationDeps {
  createChangeSet(params: CreateChangeSetParams): Promise<{ id: string }>;
  waitForChangeSet(stackName: string, changeSetName: string): Promise<void>;
  describeChangeSet(stackName: string, changeSetName: string): Promise<unknown>;
  deleteChangeSet(stackName: string, changeSetName: string): Promise<void>;
}

interface CreateChangeSetParams {
  stackName: string;
  changeSetName: string;
  templateBody: string;
  capabilities: string[];
}

// ─── Default CloudFormation Client ───────────────────────────────────────────

function createDefaultCfnDeps(region?: string, profile?: string): CloudFormationDeps {
  const awsFlags = [
    region ? `--region ${region}` : '',
    profile ? `--profile ${profile}` : '',
  ].filter(Boolean).join(' ');

  return {
    async createChangeSet(params: CreateChangeSetParams): Promise<{ id: string }> {
      const tmpFile = `/tmp/blast-radius-template-${randomUUID().slice(0, 8)}.json`;
      writeFileSync(tmpFile, params.templateBody);

      try {
        const cmd = [
          'aws cloudformation create-change-set',
          `--stack-name ${params.stackName}`,
          `--change-set-name ${params.changeSetName}`,
          `--template-body file://${tmpFile}`,
          `--capabilities ${params.capabilities.join(' ')}`,
          '--change-set-type UPDATE',
          '--output json',
          awsFlags,
        ].filter(Boolean).join(' ');

        const result = execSync(cmd, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const parsed = JSON.parse(result);
        return { id: parsed.Id };
      } finally {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    },

    async waitForChangeSet(stackName: string, changeSetName: string): Promise<void> {
      const cmd = [
        'aws cloudformation wait change-set-create-complete',
        `--stack-name ${stackName}`,
        `--change-set-name ${changeSetName}`,
        awsFlags,
      ].filter(Boolean).join(' ');

      try {
        execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        const descCmd = [
          'aws cloudformation describe-change-set',
          `--stack-name ${stackName}`,
          `--change-set-name ${changeSetName}`,
          '--output json',
          awsFlags,
        ].filter(Boolean).join(' ');

        const descResult = execSync(descCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        const desc = JSON.parse(descResult);

        if (desc.Status === 'FAILED' && desc.StatusReason?.includes("didn't contain changes")) {
          throw new Error('No changes detected between the CDK app and the deployed stack.');
        }

        throw new Error(
          `Change set creation failed: ${desc.Status} - ${desc.StatusReason ?? 'unknown reason'}`
        );
      }
    },

    async describeChangeSet(stackName: string, changeSetName: string): Promise<unknown> {
      const cmd = [
        'aws cloudformation describe-change-set',
        `--stack-name ${stackName}`,
        `--change-set-name ${changeSetName}`,
        '--output json',
        awsFlags,
      ].filter(Boolean).join(' ');

      const result = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      return JSON.parse(result);
    },

    async deleteChangeSet(stackName: string, changeSetName: string): Promise<void> {
      const cmd = [
        'aws cloudformation delete-change-set',
        `--stack-name ${stackName}`,
        `--change-set-name ${changeSetName}`,
        awsFlags,
      ].filter(Boolean).join(' ');

      try {
        execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        // Best effort cleanup
      }
    },
  };
}

// ─── Template Resolution ─────────────────────────────────────────────────────

/**
 * Synthesizes the CDK app and returns the CloudFormation template for the target stack.
 * If --app is provided, uses it. Otherwise reads from cdk.json in the current directory.
 */
function synthesizeTemplate(options: CdkDiffOptions): string {
  const appFlag = options.app ? `--app "${options.app}"` : '';
  const tmpTemplate = `/tmp/blast-radius-synth-${randomUUID().slice(0, 8)}.json`;

  // Run cdk synth and write output to a temp file
  const synthCmd = [
    'npx cdk synth',
    appFlag,
    `"${options.stack}"`,
    '--json',
    `> ${tmpTemplate}`,
    '2>/dev/null',
  ].filter(Boolean).join(' ');

  try {
    execSync(synthCmd, {
      encoding: 'utf-8',
      shell: '/bin/sh',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!existsSync(tmpTemplate)) {
      throw new Error('CDK synthesis did not produce output.');
    }

    const template = readFileSync(tmpTemplate, 'utf-8');

    if (!template || template.trim().length === 0) {
      throw new Error('CDK synthesis produced empty output.');
    }

    return template;
  } catch (err) {
    // If synth fails, check if there's a pre-existing cdk.out
    const cdkOutTemplate = join('cdk.out', `${options.stack}.template.json`);
    if (existsSync(cdkOutTemplate)) {
      return readFileSync(cdkOutTemplate, 'utf-8');
    }

    const message = err instanceof Error ? err.message : 'CDK synthesis failed';
    throw new Error(message);
  } finally {
    try { unlinkSync(tmpTemplate); } catch { /* ignore */ }
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handleCdkDiff(
  options: CdkDiffOptions,
  apiClient: ApiClient,
  cfnDeps?: CloudFormationDeps,
): Promise<CliOutput> {
  if (!options.stack) {
    return formatError('--stack is required for cdk-diff command.', options.ci);
  }

  if (options.threshold !== undefined) {
    const thresholdError = validateThreshold(options.threshold);
    if (thresholdError) {
      return formatError(thresholdError, options.ci);
    }
  }

  const cfn = cfnDeps ?? createDefaultCfnDeps(options.region, options.profile);
  const changeSetName = `blast-radius-${randomUUID().slice(0, 8)}`;

  // Step 1: Synthesize the CDK app
  if (!options.ci) {
    process.stderr.write(`Synthesizing CDK app for stack "${options.stack}"...\n`);
  }

  let templateBody: string;
  try {
    templateBody = synthesizeTemplate(options);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to synthesize CDK app';
    return formatError(message, options.ci);
  }

  // Step 2: Create the changeset
  if (!options.ci) {
    process.stderr.write(`Creating changeset against deployed stack "${options.stack}"...\n`);
  }

  try {
    await cfn.createChangeSet({
      stackName: options.stack,
      changeSetName,
      templateBody,
      capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create changeset';
    return formatError(`Failed to create changeset: ${message}`, options.ci);
  }

  // Step 3: Wait for the changeset
  if (!options.ci) {
    process.stderr.write('Computing changes...\n');
  }

  try {
    await cfn.waitForChangeSet(options.stack, changeSetName);
  } catch (err) {
    await cfn.deleteChangeSet(options.stack, changeSetName);
    const message = err instanceof Error ? err.message : 'Changeset creation failed';
    return formatError(message, options.ci);
  }

  // Step 4: Describe the changeset
  let changeset: unknown;
  try {
    changeset = await cfn.describeChangeSet(options.stack, changeSetName);
  } catch (err) {
    await cfn.deleteChangeSet(options.stack, changeSetName);
    const message = err instanceof Error ? err.message : 'Failed to describe changeset';
    return formatError(message, options.ci);
  }

  // Step 5: Delete the changeset (read-only, never execute)
  await cfn.deleteChangeSet(options.stack, changeSetName);

  if (!options.ci) {
    process.stderr.write('Submitting analysis...\n');
  }

  // Step 6: Submit to the API as cloudformation format
  let result: AnalysisResult;
  try {
    const submitResponse = await apiClient.submitAnalysis(changeset, {
      format: 'cloudformation',
      threshold: options.threshold,
      ci: options.ci,
      enableSummary: options.summary ?? true,
    });

    // The API may return immediately with status "running" (async pipeline).
    // If we got full results, use them. Otherwise poll until complete.
    if (submitResponse.riskSummary) {
      result = submitResponse;
    } else {
      // Poll for completion
      const analysisId = submitResponse.analysisId;
      if (!options.ci) {
        process.stderr.write(`Analysis ${analysisId} submitted. Waiting for results...\n`);
      }

      const maxWait = 90_000; // 90 seconds
      const pollInterval = 3_000; // 3 seconds
      const start = Date.now();
      let finalStatus: string = 'running';
      let lastUpdatedAt: string = '';
      let staleCount = 0;

      while (Date.now() - start < maxWait) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        const status = await apiClient.getStatus(analysisId);
        finalStatus = status.status;
        if (status.status === 'completed' || status.status === 'failed') {
          break;
        }

        // Detect stale — if updatedAt hasn't changed for 5 polls (15s), likely failed silently
        const updatedAt = (status as unknown as { updatedAt?: string }).updatedAt ?? '';
        if (updatedAt && updatedAt === lastUpdatedAt) {
          staleCount++;
          if (staleCount >= 5) {
            finalStatus = 'failed';
            break;
          }
        } else {
          staleCount = 0;
          lastUpdatedAt = updatedAt;
        }
      }

      // Handle failure
      if (finalStatus === 'failed') {
        return formatError(
          `Analysis ${analysisId} failed. View details in the Blast Radius frontend.`,
          options.ci,
        );
      }

      // Handle timeout
      if (finalStatus === 'running') {
        return formatError(
          `Analysis ${analysisId} timed out waiting for results (90s). It may still be running.\nCheck status: blast-radius status --analysis-id ${analysisId}`,
          options.ci,
        );
      }

      // Fetch final results
      try {
        result = await apiClient.getExport(analysisId, 'json');
      } catch {
        // If export fails, try getAnalysis (which reads from S3)
        try {
          result = await apiClient.getStatus(analysisId) as unknown as AnalysisResult;
        } catch {
          return {
            exitCode: 0,
            output: options.ci
              ? JSON.stringify({ analysisId, status: 'completed' }, null, 2)
              : `Analysis completed: ${analysisId}\nView results: blast-radius export --analysis-id ${analysisId}`,
          };
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis submission failed';
    return formatError(message, options.ci);
  }

  // Step 7: Evaluate verdict if threshold provided
  if (options.threshold !== undefined && result.scoredResources) {
    const verdict = evaluateThreshold(result.scoredResources, options.threshold);

    // Check AI gate — if AI recommends against deploy, override to fail
    const aiRecommendation = (result as unknown as { recommendDeploy?: boolean; confidence?: string }).recommendDeploy;
    const aiConfidence = (result as unknown as { confidence?: string }).confidence;
    const aiGateFailed = options.aiGate && aiRecommendation === false;

    if (options.ci) {
      const ciOutput = {
        ...verdict,
        analysisId: result.analysisId,
        ...(result.naturalLanguageSummary ? { naturalLanguageSummary: result.naturalLanguageSummary } : {}),
        ...(result.riskSummary ? { riskSummary: result.riskSummary } : {}),
        ...(aiRecommendation !== undefined ? { recommendDeploy: aiRecommendation } : {}),
        ...(aiConfidence ? { confidence: aiConfidence } : {}),
        ...(aiGateFailed ? { verdict: 'fail', exitCode: 1, reason: 'ai-gate' } : {}),
      };
      return {
        exitCode: aiGateFailed ? 1 : verdict.exitCode,
        output: JSON.stringify(ciOutput, null, 2),
      };
    }

    if (aiGateFailed) {
      return {
        exitCode: 1,
        output: [
          '✗ FAIL — AI recommends against deployment.',
          `  Confidence: ${aiConfidence ?? 'unknown'}`,
          `  Total affected: ${result.riskSummary?.totalAffected ?? 0}`,
          `  Highest score: ${result.riskSummary?.highestScore ?? 0}`,
          '',
          result.naturalLanguageSummary ?? '',
        ].join('\n'),
      };
    }

    return formatVerdict(verdict, false);
  }

  // No threshold — check AI gate alone
  const aiRecommendation = (result as unknown as { recommendDeploy?: boolean; confidence?: string }).recommendDeploy;
  const aiConfidence = (result as unknown as { confidence?: string }).confidence;
  const aiGateFailed = options.aiGate && aiRecommendation === false;

  if (options.ci) {
    return {
      exitCode: aiGateFailed ? 1 : 0,
      output: JSON.stringify({
        analysisId: result.analysisId,
        status: result.status,
        riskSummary: result.riskSummary,
        ...(result.naturalLanguageSummary ? { naturalLanguageSummary: result.naturalLanguageSummary } : {}),
        ...(aiRecommendation !== undefined ? { recommendDeploy: aiRecommendation } : {}),
        ...(aiConfidence ? { confidence: aiConfidence } : {}),
        ...(aiGateFailed ? { verdict: 'fail', reason: 'ai-gate' } : { verdict: 'pass' }),
        scoredResources: result.scoredResources,
      }, null, 2),
    };
  }

  if (aiGateFailed) {
    return {
      exitCode: 1,
      output: [
        '✗ FAIL — AI recommends against deployment.',
        `  Confidence: ${aiConfidence ?? 'unknown'}`,
        `  Total affected: ${result.riskSummary?.totalAffected ?? 0}`,
        `  Highest score: ${result.riskSummary?.highestScore ?? 0}`,
        '',
        result.naturalLanguageSummary ?? '',
      ].join('\n'),
    };
  }

  const lines = [
    `Analysis ID: ${result.analysisId}`,
    `Status: ${result.status}`,
    `Stack: ${options.stack}`,
  ];

  if (result.riskSummary) {
    lines.push(
      '',
      'Risk Summary:',
      `  Critical: ${result.riskSummary.critical}`,
      `  High: ${result.riskSummary.high}`,
      `  Medium: ${result.riskSummary.medium}`,
      `  Low: ${result.riskSummary.low}`,
      `  Total Affected: ${result.riskSummary.totalAffected}`,
      `  Highest Score: ${result.riskSummary.highestScore}`,
    );
  }

  if (result.naturalLanguageSummary) {
    lines.push('', 'Summary:', result.naturalLanguageSummary);
  }

  return {
    exitCode: 0,
    output: lines.join('\n'),
  };
}

