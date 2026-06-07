/**
 * Generate command — produces input files in native or canonical format.
 *
 * For CDK: creates a CloudFormation changeset and saves it as JSON.
 * For Terraform: saves the plan JSON as-is.
 * For any format: optionally converts to canonical via the API's adapter.
 *
 * Usage:
 *   blast-radius generate --format cdk --stack MyStack --output changeset.json
 *   blast-radius generate --format cdk --stack MyStack --output canonical.json --canonical
 *   blast-radius generate --format terraform-plan --input plan.json --output example.json
 *   blast-radius generate --format cloudformation --input changeset.json --output example.json
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { CliOutput } from './index.js';
import { formatError } from './index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GenerateOptions {
  /** Source format: cdk, terraform-plan, cloudformation, canonical */
  format: string;
  /** Output file path */
  output: string;
  /** For cdk: the deployed stack name */
  stack?: string;
  /** For cdk: CDK app command */
  app?: string;
  /** For terraform/cloudformation: input file to copy or convert */
  input?: string;
  /** AWS region */
  region?: string;
  /** AWS profile */
  profile?: string;
  /** Machine-readable output */
  ci?: boolean;
}

// ─── CDK Changeset Generation ────────────────────────────────────────────────

function generateCdkChangeset(options: GenerateOptions): unknown {
  if (!options.stack) {
    throw new Error('--stack is required when generating CDK format.');
  }

  const awsFlags = [
    options.region ? `--region ${options.region}` : '',
    options.profile ? `--profile ${options.profile}` : '',
  ].filter(Boolean).join(' ');

  const appFlag = options.app ? `--app "${options.app}"` : '';

  // Step 1: Synthesize the template
  const tmpTemplate = `/tmp/blast-radius-synth-${randomUUID().slice(0, 8)}.json`;
  const synthCmd = [
    'npx cdk synth',
    appFlag,
    `"${options.stack}"`,
    '--json',
    `> ${tmpTemplate}`,
    '2>/dev/null',
  ].filter(Boolean).join(' ');

  execSync(synthCmd, { encoding: 'utf-8', shell: '/bin/sh', stdio: ['pipe', 'pipe', 'pipe'] });

  const templateBody = readFileSync(tmpTemplate, 'utf-8');
  try { unlinkSync(tmpTemplate); } catch { /* ignore */ }

  if (!templateBody || templateBody.trim().length === 0) {
    throw new Error('CDK synthesis produced empty output.');
  }

  // Step 2: Create changeset
  const changeSetName = `blast-radius-gen-${randomUUID().slice(0, 8)}`;
  const tmpCfnTemplate = `/tmp/blast-radius-cfn-${randomUUID().slice(0, 8)}.json`;
  writeFileSync(tmpCfnTemplate, templateBody);

  try {
    const createCmd = [
      'aws cloudformation create-change-set',
      `--stack-name ${options.stack}`,
      `--change-set-name ${changeSetName}`,
      `--template-body file://${tmpCfnTemplate}`,
      '--capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND',
      '--change-set-type UPDATE',
      '--output json',
      awsFlags,
    ].filter(Boolean).join(' ');

    execSync(createCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

    // Step 3: Wait for changeset
    const waitCmd = [
      'aws cloudformation wait change-set-create-complete',
      `--stack-name ${options.stack}`,
      `--change-set-name ${changeSetName}`,
      awsFlags,
    ].filter(Boolean).join(' ');

    try {
      execSync(waitCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      const descCmd = [
        'aws cloudformation describe-change-set',
        `--stack-name ${options.stack}`,
        `--change-set-name ${changeSetName}`,
        '--output json',
        awsFlags,
      ].filter(Boolean).join(' ');
      const desc = JSON.parse(
        execSync(descCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
      );

      // Cleanup
      const delCmd = [
        'aws cloudformation delete-change-set',
        `--stack-name ${options.stack}`,
        `--change-set-name ${changeSetName}`,
        awsFlags,
      ].filter(Boolean).join(' ');
      try { execSync(delCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }); } catch { /* */ }

      if (desc.StatusReason?.includes("didn't contain changes")) {
        throw new Error('No changes detected between the CDK app and the deployed stack.');
      }
      throw new Error(`Changeset failed: ${desc.StatusReason ?? 'unknown'}`);
    }

    // Step 4: Describe changeset
    const descCmd = [
      'aws cloudformation describe-change-set',
      `--stack-name ${options.stack}`,
      `--change-set-name ${changeSetName}`,
      '--output json',
      awsFlags,
    ].filter(Boolean).join(' ');

    const changeset = JSON.parse(
      execSync(descCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    );

    // Step 5: Delete changeset
    const delCmd = [
      'aws cloudformation delete-change-set',
      `--stack-name ${options.stack}`,
      `--change-set-name ${changeSetName}`,
      awsFlags,
    ].filter(Boolean).join(' ');
    try { execSync(delCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }); } catch { /* */ }

    return changeset;
  } finally {
    try { unlinkSync(tmpCfnTemplate); } catch { /* ignore */ }
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handleGenerate(options: GenerateOptions): Promise<CliOutput> {
  if (!options.format) {
    return formatError('--format is required for generate command.', options.ci);
  }

  if (!options.output) {
    return formatError('--output is required for generate command.', options.ci);
  }

  let payload: unknown;

  try {
    switch (options.format) {
      case 'cdk': {
        if (!options.ci) {
          process.stderr.write(`Generating CloudFormation changeset for stack "${options.stack}"...\n`);
        }
        payload = generateCdkChangeset(options);
        break;
      }

      case 'terraform-plan':
      case 'cloudformation': {
        if (!options.input) {
          return formatError(
            `--input is required when generating ${options.format} format.`,
            options.ci,
          );
        }
        if (!existsSync(options.input)) {
          return formatError(`Input file not found: ${options.input}`, options.ci);
        }
        payload = JSON.parse(readFileSync(options.input, 'utf-8'));
        break;
      }

      default:
        return formatError(
          `Unsupported format: "${options.format}". Supported: cdk, terraform-plan, cloudformation.`,
          options.ci,
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    return formatError(message, options.ci);
  }

  // Write the output
  const outputJson = JSON.stringify(payload, null, 2);
  writeFileSync(options.output, outputJson + '\n');

  const size = Buffer.byteLength(outputJson);
  const changeCount = options.format === 'cdk' || options.format === 'cloudformation'
    ? (payload as { Changes?: unknown[] }).Changes?.length ?? 0
    : (payload as { resource_changes?: unknown[] }).resource_changes?.length ?? 0;

  if (options.ci) {
    return {
      exitCode: 0,
      output: JSON.stringify({
        format: options.format === 'cdk' ? 'cloudformation' : options.format,
        output: options.output,
        changes: changeCount,
        bytes: size,
      }, null, 2),
    };
  }

  return {
    exitCode: 0,
    output: [
      `✓ Saved to ${options.output}`,
      `  Format: ${options.format === 'cdk' ? 'cloudformation (from CDK)' : options.format}`,
      `  Changes: ${changeCount} resource(s)`,
      `  Size: ${(size / 1024).toFixed(1)} KB`,
      '',
      'Use with:',
      `  blast-radius analyze --format ${options.format === 'cdk' ? 'cloudformation' : options.format} --input ${options.output}`,
    ].join('\n'),
  };
}
