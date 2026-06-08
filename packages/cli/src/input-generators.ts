/**
 * Input generators — auto-generate changesets/plans for each supported format.
 *
 * Each generator produces a JSON payload ready to submit to the Blast Radius API.
 * If --input is provided, these are skipped entirely.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export interface GeneratorOptions {
  format: string;
  stack?: string;
  app?: string;
  template?: string;
  region?: string;
  profile?: string;
}

/**
 * Auto-generate the input payload based on format and options.
 * Returns the JSON payload ready for the API.
 */
export function autoGenerate(options: GeneratorOptions): unknown {
  switch (options.format) {
    case 'cdk':
      return generateCdkChangeset(options);
    case 'cloudformation':
      return generateCfnChangeset(options);
    case 'terraform-plan':
      return generateTerraformPlan(options);
    default:
      throw new Error(
        `Cannot auto-generate for format "${options.format}". Use --input to provide a file.`
      );
  }
}

// ─── CDK ─────────────────────────────────────────────────────────────────────

function generateCdkChangeset(options: GeneratorOptions): unknown {
  if (!options.stack) {
    throw new Error('--stack is required for CDK format.');
  }

  // Step 1: Synthesize CDK app
  const template = synthesizeCdkApp(options);

  // Step 2: Create and describe changeset
  return createAndDescribeChangeset(options.stack, template, options);
}

function synthesizeCdkApp(options: GeneratorOptions): string {
  const appFlag = options.app ? `--app "${options.app}"` : '';
  const tmpTemplate = `/tmp/blast-radius-synth-${randomUUID().slice(0, 8)}.json`;

  const synthCmd = [
    'npx cdk synth',
    appFlag,
    `"${options.stack}"`,
    '--json',
    `> ${tmpTemplate}`,
    '2>/dev/null',
  ].filter(Boolean).join(' ');

  try {
    execSync(synthCmd, { encoding: 'utf-8', shell: '/bin/sh', stdio: ['pipe', 'pipe', 'pipe'] });

    if (!existsSync(tmpTemplate)) {
      throw new Error('CDK synthesis did not produce output.');
    }

    const template = readFileSync(tmpTemplate, 'utf-8');
    if (!template || template.trim().length === 0) {
      throw new Error('CDK synthesis produced empty output.');
    }

    return template;
  } catch (err) {
    // Fall back to cdk.out if synth fails
    const cdkOutTemplate = `cdk.out/${options.stack}.template.json`;
    if (existsSync(cdkOutTemplate)) {
      return readFileSync(cdkOutTemplate, 'utf-8');
    }
    const message = err instanceof Error ? err.message : 'CDK synthesis failed';
    throw new Error(message);
  } finally {
    try { unlinkSync(tmpTemplate); } catch { /* ignore */ }
  }
}

// ─── CloudFormation ──────────────────────────────────────────────────────────

function generateCfnChangeset(options: GeneratorOptions): unknown {
  if (!options.stack) {
    throw new Error('--stack is required for CloudFormation format.');
  }
  if (!options.template) {
    throw new Error('--template is required for CloudFormation format (path to the CloudFormation template JSON/YAML).');
  }
  if (!existsSync(options.template)) {
    throw new Error(`Template file not found: ${options.template}`);
  }

  const template = readFileSync(options.template, 'utf-8');
  return createAndDescribeChangeset(options.stack, template, options);
}

// ─── Terraform ───────────────────────────────────────────────────────────────

function generateTerraformPlan(options: GeneratorOptions): unknown {
  // Run terraform plan and export as JSON
  const planFile = `/tmp/blast-radius-tfplan-${randomUUID().slice(0, 8)}`;

  try {
    process.stderr.write('Running terraform plan...\n');
    execSync(`terraform plan -out=${planFile}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    process.stderr.write('Exporting plan as JSON...\n');
    const planJson = execSync(`terraform show -json ${planFile}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return JSON.parse(planJson);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Terraform plan failed';
    throw new Error(`Terraform plan generation failed: ${message}`);
  } finally {
    try { unlinkSync(planFile); } catch { /* ignore */ }
  }
}

// ─── Shared: CloudFormation Changeset ────────────────────────────────────────

function createAndDescribeChangeset(
  stackName: string,
  templateBody: string,
  options: GeneratorOptions,
): unknown {
  const awsFlags = [
    options.region ? `--region ${options.region}` : '',
    options.profile ? `--profile ${options.profile}` : '',
  ].filter(Boolean).join(' ');

  const changeSetName = `blast-radius-${randomUUID().slice(0, 8)}`;
  const tmpFile = `/tmp/blast-radius-template-${randomUUID().slice(0, 8)}.json`;
  writeFileSync(tmpFile, templateBody);

  try {
    // Create changeset
    process.stderr.write(`Creating changeset against stack "${stackName}"...\n`);
    const createCmd = [
      'aws cloudformation create-change-set',
      `--stack-name ${stackName}`,
      `--change-set-name ${changeSetName}`,
      `--template-body file://${tmpFile}`,
      '--capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND',
      '--change-set-type UPDATE',
      '--output json',
      awsFlags,
    ].filter(Boolean).join(' ');

    execSync(createCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

    // Wait for changeset
    process.stderr.write('Computing changes...\n');
    const waitCmd = [
      'aws cloudformation wait change-set-create-complete',
      `--stack-name ${stackName}`,
      `--change-set-name ${changeSetName}`,
      awsFlags,
    ].filter(Boolean).join(' ');

    try {
      execSync(waitCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      const descCmd = [
        'aws cloudformation describe-change-set',
        `--stack-name ${stackName}`,
        `--change-set-name ${changeSetName}`,
        '--output json',
        awsFlags,
      ].filter(Boolean).join(' ');
      const desc = JSON.parse(
        execSync(descCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
      );

      deleteChangeset(stackName, changeSetName, awsFlags);

      if (desc.StatusReason?.includes("didn't contain changes")) {
        throw new Error('No changes detected between the template and the deployed stack.');
      }
      throw new Error(`Changeset failed: ${desc.StatusReason ?? 'unknown'}`);
    }

    // Describe changeset
    const descCmd = [
      'aws cloudformation describe-change-set',
      `--stack-name ${stackName}`,
      `--change-set-name ${changeSetName}`,
      '--output json',
      awsFlags,
    ].filter(Boolean).join(' ');

    const changeset = JSON.parse(
      execSync(descCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    );

    // Delete changeset (read-only, never execute)
    deleteChangeset(stackName, changeSetName, awsFlags);

    return changeset;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function deleteChangeset(stackName: string, changeSetName: string, awsFlags: string): void {
  const cmd = [
    'aws cloudformation delete-change-set',
    `--stack-name ${stackName}`,
    `--change-set-name ${changeSetName}`,
    awsFlags,
  ].filter(Boolean).join(' ');
  try { execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }); } catch { /* */ }
}
