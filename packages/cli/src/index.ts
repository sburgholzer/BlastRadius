#!/usr/bin/env node

/**
 * Blast Radius CLI - Command-line tool for CI/CD pipeline integration.
 *
 * Commands:
 *   blast-radius analyze  - Submit a manifest/changeset for analysis
 *   blast-radius status   - Check analysis status
 *   blast-radius export   - Export analysis results
 *
 * Exit codes:
 *   0 = pass (no resource exceeds threshold)
 *   1 = fail (resources exceed threshold)
 *   2 = error (analysis failure, invalid input, or timeout)
 *
 * Validates: Requirements 7.3, 7.4, 7.5, 7.6
 */

import { evaluateThreshold, validateThreshold } from '@blast-radius/core';
import type {
  AnalysisResult,
  AnalysisStatus,
  VerdictResult,
} from '@blast-radius/core';
import { handleCdkDiff } from './cdk-diff.js';
import type { CdkDiffOptions } from './cdk-diff.js';
import { handleGenerate } from './generate.js';
import type { GenerateOptions } from './generate.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  format?: string;
  input?: string;
  threshold?: number;
  ci?: boolean;
  enableSummary?: boolean;
}

export interface StatusOptions {
  analysisId: string;
}

export interface ExportOptions {
  analysisId: string;
  format?: string;
}

export interface CliOutput {
  exitCode: number;
  output: string;
}

export interface ApiClient {
  submitAnalysis(payload: unknown, options: AnalyzeOptions): Promise<AnalysisResult>;
  getStatus(analysisId: string): Promise<AnalysisStatus>;
  getExport(analysisId: string, format: string): Promise<AnalysisResult>;
}

// ─── Argument Parsing ────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): {
  command: string;
  flags: Record<string, string | boolean>;
} {
  const args = argv.slice(2); // skip node and script path
  const command = args[0] || '';
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        flags[key] = nextArg;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }

  return { command, flags };
}

// ─── Input Reading ───────────────────────────────────────────────────────────

export async function readInput(inputPath?: string): Promise<string> {
  const fs = await import('fs');
  const { stdin } = process;

  if (inputPath) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }
    return fs.readFileSync(inputPath, 'utf-8');
  }

  // Read from stdin
  return new Promise<string>((resolve, reject) => {
    let data = '';
    stdin.setEncoding('utf-8');
    stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    stdin.on('end', () => resolve(data));
    stdin.on('error', (err: Error) => reject(err));

    // If stdin is a TTY (no piped input), return empty after short timeout
    if (stdin.isTTY) {
      resolve('');
    }
  });
}

// ─── Command Handlers ────────────────────────────────────────────────────────

export async function handleAnalyze(
  options: AnalyzeOptions,
  apiClient: ApiClient,
  inputData?: string
): Promise<CliOutput> {
  // Read input from file or stdin
  let payload: string;
  try {
    payload = inputData ?? (await readInput(options.input));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to read input';
    return formatError(message, options.ci);
  }

  if (!payload || payload.trim() === '') {
    return formatError(
      'No input provided. Use --input <file> or pipe data via stdin.',
      options.ci
    );
  }

  // Parse input JSON
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    return formatError('Invalid JSON input. Could not parse input data.', options.ci);
  }

  // Validate threshold if provided
  if (options.threshold !== undefined) {
    const thresholdError = validateThreshold(options.threshold);
    if (thresholdError) {
      return formatError(thresholdError, options.ci);
    }
  }

  // Submit analysis
  let result: AnalysisResult;
  try {
    result = await apiClient.submitAnalysis(parsedPayload, options);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Analysis request failed';
    return formatError(message, options.ci);
  }

  // If threshold is provided, evaluate verdict
  if (options.threshold !== undefined) {
    const verdict = evaluateThreshold(result.scoredResources, options.threshold);
    return formatVerdict(verdict, options.ci);
  }

  // No threshold: return full results
  if (options.ci) {
    return {
      exitCode: 0,
      output: JSON.stringify(result, null, 2),
    };
  }

  return {
    exitCode: 0,
    output: formatAnalysisHuman(result),
  };
}

export async function handleStatus(
  options: StatusOptions,
  apiClient: ApiClient,
  ci?: boolean
): Promise<CliOutput> {
  if (!options.analysisId) {
    return formatError('--analysis-id is required for status command.', ci);
  }

  let status: AnalysisStatus;
  try {
    status = await apiClient.getStatus(options.analysisId);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to retrieve status';
    return formatError(message, ci);
  }

  if (ci) {
    return {
      exitCode: 0,
      output: JSON.stringify(status, null, 2),
    };
  }

  return {
    exitCode: 0,
    output: formatStatusHuman(status),
  };
}

export async function handleExport(
  options: ExportOptions,
  apiClient: ApiClient,
  ci?: boolean
): Promise<CliOutput> {
  if (!options.analysisId) {
    return formatError('--analysis-id is required for export command.', ci);
  }

  const format = options.format || 'json';
  if (format !== 'json' && format !== 'pdf') {
    return formatError(
      `Unsupported export format: ${format}. Supported formats: json, pdf.`,
      ci
    );
  }

  let result: AnalysisResult;
  try {
    result = await apiClient.getExport(options.analysisId, format);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to export results';
    return formatError(message, ci);
  }

  // JSON export always outputs JSON
  return {
    exitCode: 0,
    output: JSON.stringify(result, null, 2),
  };
}

// ─── Output Formatting ───────────────────────────────────────────────────────

export function formatVerdict(verdict: VerdictResult, ci?: boolean): CliOutput {
  if (ci) {
    return {
      exitCode: verdict.exitCode,
      output: JSON.stringify(verdict, null, 2),
    };
  }

  switch (verdict.verdict) {
    case 'pass':
      return {
        exitCode: 0,
        output: [
          '✓ PASS - No resources exceed the risk threshold.',
          `  Total affected resources: ${verdict.summary.totalAffected}`,
          `  Highest impact score: ${verdict.summary.highestScore}`,
        ].join('\n'),
      };
    case 'fail':
      return {
        exitCode: 1,
        output: [
          '✗ FAIL - Resources exceed the risk threshold.',
          `  Total affected: ${verdict.summary.totalAffected}`,
          `  Exceeding threshold: ${verdict.summary.exceedingCount}`,
          `  Highest impact score: ${verdict.summary.highestScore}`,
          '',
          'Resources exceeding threshold:',
          ...verdict.exceedingResources.map(
            (r) =>
              `  - ${r.resourceId} (${r.resourceType}) score=${r.impactScore} [${r.riskCategory}]`
          ),
        ].join('\n'),
      };
    case 'error':
      return {
        exitCode: 2,
        output: `Error: ${verdict.message}`,
      };
  }
}

export function formatError(message: string, ci?: boolean): CliOutput {
  if (ci) {
    return {
      exitCode: 2,
      output: JSON.stringify({ error: message }, null, 2),
    };
  }
  return {
    exitCode: 2,
    output: `Error: ${message}`,
  };
}

function formatAnalysisHuman(result: AnalysisResult): string {
  const lines = [
    `Analysis ID: ${result.analysisId}`,
    `Status: ${result.status}`,
    `Source Format: ${result.sourceFormat}`,
    `Submitted: ${result.submittedAt}`,
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

  return lines.join('\n');
}

function formatStatusHuman(status: AnalysisStatus): string {
  return [
    `Analysis ID: ${status.analysisId}`,
    `Status: ${status.status}`,
    `Current Stage: ${status.currentStage}`,
    `Progress: ${status.progressPercentage}%`,
    `Elapsed: ${status.elapsedTimeMs}ms`,
  ].join('\n');
}

// ─── Default API Client (HTTP) ───────────────────────────────────────────────

function createDefaultApiClient(baseUrl?: string): ApiClient {
  const url = baseUrl || process.env.BLAST_RADIUS_API_URL || '';

  return {
    async submitAnalysis(
      payload: unknown,
      options: AnalyzeOptions
    ): Promise<AnalysisResult> {
      if (!url) {
        throw new Error(
          'API URL not configured. Set BLAST_RADIUS_API_URL environment variable.'
        );
      }

      const body = JSON.stringify({
        format: options.format || 'canonical',
        manifest: payload,
        options: {
          riskThreshold: options.threshold,
          enableSummary: options.enableSummary ?? true,
        },
      });

      const response = await fetch(`${url}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API error (${response.status}): ${errorBody}`);
      }

      return response.json() as Promise<AnalysisResult>;
    },

    async getStatus(analysisId: string): Promise<AnalysisStatus> {
      if (!url) {
        throw new Error(
          'API URL not configured. Set BLAST_RADIUS_API_URL environment variable.'
        );
      }

      const response = await fetch(`${url}/analyze/${analysisId}`);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API error (${response.status}): ${errorBody}`);
      }

      return response.json() as Promise<AnalysisStatus>;
    },

    async getExport(
      analysisId: string,
      format: string
    ): Promise<AnalysisResult> {
      if (!url) {
        throw new Error(
          'API URL not configured. Set BLAST_RADIUS_API_URL environment variable.'
        );
      }

      const response = await fetch(
        `${url}/analyze/${analysisId}/export?format=${format}`
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API error (${response.status}): ${errorBody}`);
      }

      return response.json() as Promise<AnalysisResult>;
    },
  };
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function main(
  argv: string[],
  apiClient?: ApiClient,
  inputData?: string
): Promise<CliOutput> {
  const { command, flags } = parseArgs(argv);

  const ci = flags.ci === true;
  const client = apiClient || createDefaultApiClient();

  switch (command) {
    case 'analyze': {
      const options: AnalyzeOptions = {
        format: typeof flags.format === 'string' ? flags.format : undefined,
        input: typeof flags.input === 'string' ? flags.input : undefined,
        threshold:
          typeof flags.threshold === 'string'
            ? Number(flags.threshold)
            : undefined,
        ci,
      };
      return handleAnalyze(options, client, inputData);
    }

    case 'status': {
      const options: StatusOptions = {
        analysisId:
          typeof flags['analysis-id'] === 'string'
            ? flags['analysis-id']
            : '',
      };
      return handleStatus(options, client, ci);
    }

    case 'export': {
      const options: ExportOptions = {
        analysisId:
          typeof flags['analysis-id'] === 'string'
            ? flags['analysis-id']
            : '',
        format: typeof flags.format === 'string' ? flags.format : undefined,
      };
      return handleExport(options, client, ci);
    }

    case 'cdk-diff': {
      const cdkOptions: CdkDiffOptions = {
        stack: typeof flags.stack === 'string' ? flags.stack : '',
        app: typeof flags.app === 'string' ? flags.app : undefined,
        region: typeof flags.region === 'string' ? flags.region : undefined,
        profile: typeof flags.profile === 'string' ? flags.profile : undefined,
        threshold:
          typeof flags.threshold === 'string'
            ? Number(flags.threshold)
            : undefined,
        summary: flags['no-summary'] === true ? false : true,
        ci,
      };
      return handleCdkDiff(cdkOptions, client);
    }

    case 'generate': {
      const genOptions: GenerateOptions = {
        format: typeof flags.format === 'string' ? flags.format : '',
        output: typeof flags.output === 'string' ? flags.output : '',
        stack: typeof flags.stack === 'string' ? flags.stack : undefined,
        app: typeof flags.app === 'string' ? flags.app : undefined,
        input: typeof flags.input === 'string' ? flags.input : undefined,
        region: typeof flags.region === 'string' ? flags.region : undefined,
        profile: typeof flags.profile === 'string' ? flags.profile : undefined,
        ci,
      };
      return handleGenerate(genOptions);
    }

    default:
      return formatError(
        [
          `Unknown command: "${command}"`,
          '',
          'Usage:',
          '  blast-radius analyze [--format <format>] [--input <file>] [--threshold <0-100>] [--ci]',
          '  blast-radius cdk-diff --stack <name> [--app <cmd>] [--threshold <0-100>] [--ci]',
          '  blast-radius generate --format <format> --output <file> [--stack <name>] [--input <file>]',
          '  blast-radius status --analysis-id <id>',
          '  blast-radius export --analysis-id <id> [--format json|pdf]',
          '',
          'Formats: canonical, cloudformation, terraform-plan, cdk',
          '',
          'Exit codes:',
          '  0 = pass (no resource exceeds threshold)',
          '  1 = fail (resources exceed threshold)',
          '  2 = error (analysis failure or invalid input)',
        ].join('\n'),
        ci
      );
  }
}

// Run when executed directly
/* istanbul ignore next */
if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv).then((result) => {
    if (result.output) {
      if (result.exitCode === 0) {
        process.stdout.write(result.output + '\n');
      } else {
        process.stderr.write(result.output + '\n');
      }
    }
    process.exit(result.exitCode);
  });
}
