← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# CLI (packages/cli)

Command-line tool for CI/CD pipeline integration. Wraps the REST API and adds CDK-specific workflows for generating changesets automatically.

**The mental model:** It's like the frontend but for robots. Instead of a visual graph, it outputs JSON. Instead of clicking buttons, it uses exit codes (0 = proceed, 1 = stop, 2 = broken).

**Five commands:**
```bash
# "Should I deploy this?" — the main use case
blast-radius analyze --format terraform-plan --input plan.json --threshold 75 --ci

# CDK-specific: synth + changeset + analyze in one step
blast-radius cdk-diff --stack MyStack --threshold 75 --ci

# Generate example input files for testing/demos
blast-radius generate --format cdk --stack MyStack --output changeset.json

# "Is my analysis done yet?"
blast-radius status --analysis-id abc-123

# "Give me the full results"
blast-radius export --analysis-id abc-123 --format json
```

## The `analyze` command

The generic entry point. Reads a pre-built changeset file and submits it to the API.

**Flow:**
1. Read input (from `--input` file path or stdin pipe)
2. Parse as JSON (fail with exit 2 if invalid)
3. Validate threshold if provided (fail with exit 2 if outside 0-100)
4. POST to the API → get back full analysis results
5. If `--threshold` was set → evaluate pass/fail verdict
6. Output results (JSON in `--ci` mode, human-readable otherwise)
7. Exit with appropriate code

**Options:**
- `--format <format>` — Input format: `canonical`, `cloudformation`, `terraform-plan`, `cdk`
- `--input <path>` — File path (or pipe via stdin)
- `--threshold <0-100>` — Risk threshold for pass/fail verdict
- `--ci` — Machine-readable JSON output
- `--no-summary` — Disables AI summary generation
- `--region`, `--profile` — AWS config overrides

**Input flexibility:**
```bash
terraform show -json plan.out | blast-radius analyze --format terraform-plan --threshold 75 --ci
cat changeset.json | blast-radius analyze --format cloudformation --ci
blast-radius analyze --input my-manifest.json --format canonical
```

**CI output includes:** `analysisId`, `riskSummary`, `naturalLanguageSummary`, `verdict` (when `--threshold` used).

## The `cdk-diff` command

CDK-specific workflow that automates the entire changeset generation process. No pre-built files needed — just point it at a stack.

**Flow:**
1. Run `cdk synth` to produce the CloudFormation template (uses `--app` or reads `cdk.json`)
2. Create a read-only CloudFormation changeset against the deployed stack
3. Poll until the changeset is ready
4. Describe the changeset (structured JSON with Actions, Replacements, etc.)
5. Delete the changeset (never executed)
6. Submit to the API as `format: "cloudformation"` with `enableSummary` option
7. Poll for results with stale detection

**Options:**
- `--stack <name>` — (required) CloudFormation stack name to diff against
- `--app <command>` — CDK app command (optional, reads `cdk.json` if omitted)
- `--threshold <0-100>` — Risk threshold for pass/fail verdict
- `--no-summary` — Disables AI summary generation
- `--ci` — Machine-readable JSON output
- `--region`, `--profile` — AWS config overrides

**Usage:**
```bash
# From within a CDK project directory (reads cdk.json):
blast-radius cdk-diff --stack BlastRadiusDemoBaseline

# Or specify the CDK app command explicitly:
blast-radius cdk-diff --stack BlastRadiusDemoBaseline --app "npx ts-node lib/app.ts"

# CI mode with threshold:
blast-radius cdk-diff --stack BlastRadiusDemoBaseline --threshold 75 --ci

# Disable AI summary:
blast-radius cdk-diff --stack MyStack --no-summary

# With AWS profile/region:
blast-radius cdk-diff --stack MyStack --profile prod --region eu-west-1
```

**Why this approach?** CDK doesn't produce a machine-readable diff natively. The `cdk diff` command outputs human-readable text. But CloudFormation's `CreateChangeSet` + `DescribeChangeSet` gives us structured JSON with exact actions, replacement info, and cascading dependencies — which is exactly what the CloudFormation adapter expects.

## The `generate` command

Produces input files in native format for testing, demos, or feeding into the `analyze` command later.

**Usage:**
```bash
# Generate a CloudFormation changeset from a CDK project:
blast-radius generate --format cdk --stack MyStack --output changeset.json

# Copy/validate a Terraform plan:
blast-radius generate --format terraform-plan --input plan.json --output example.json

# Copy/validate a CloudFormation changeset:
blast-radius generate --format cloudformation --input changeset.json --output example.json
```

**Output:**
```
✓ Saved to changeset.json
  Format: cloudformation (from CDK)
  Changes: 7 resource(s)
  Size: 6.2 KB

Use with:
  blast-radius analyze --format cloudformation --input changeset.json
```

## Polling and Stale Detection

After submitting an analysis, the CLI polls for results every 3 seconds. It includes stale detection: if the `updatedAt` timestamp remains unchanged for 5 consecutive polls (~15 seconds), the CLI assumes the pipeline has silently failed and reports a failure.

**Failure modes:**
- Pipeline reports `status: "failed"` → exit code 2, prints error details
- Stale detection triggers → exit code 2, prints "Analysis appears stuck"
- Poll timeout (configurable, default 120s) → exit code 2, prints timeout message

## The `status` command

Quick check on a running analysis:
```bash
blast-radius status --analysis-id abc-123
# → Running (Stage: Scoring, Progress: 60%)
```

## The `export` command

Fetch full results for a completed analysis:
```bash
blast-radius export --analysis-id abc-123 --format json > results.json
```

## Output modes

Human-readable (default):
```
✓ PASS - No resources exceed the risk threshold.
  Total affected resources: 12
  Highest impact score: 68
  AI Summary: The proposed changes affect 3 critical resources...
```

Machine-readable (`--ci` flag):
```json
{
  "analysisId": "abc-123",
  "verdict": "pass",
  "exitCode": 0,
  "riskSummary": { "totalAffected": 12, "highestScore": 68, "criticalCount": 2 },
  "naturalLanguageSummary": "The proposed changes affect..."
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Analysis complete, threshold passed (or no threshold) |
| 1 | Analysis complete, threshold exceeded (verdict: fail) |
| 2 | Error — invalid input, pipeline failure, timeout |

## CI/CD Integration Examples

**GitHub Actions:**
```yaml
- name: Blast Radius Check
  run: |
    blast-radius cdk-diff --stack ${{ env.STACK_NAME }} --threshold 75 --ci
  env:
    BLAST_RADIUS_API_URL: ${{ secrets.BLAST_RADIUS_URL }}
    AWS_REGION: us-east-1
```

**GitLab CI:**
```yaml
blast-radius:
  script:
    - blast-radius analyze --format terraform-plan --input plan.json --threshold 80 --ci
  allow_failure:
    exit_codes: [1]  # threshold exceeded = warning, not blocker
```

## Architecture

**Three source files:**
- `src/index.ts` — Main entry point, argument parsing, `analyze`/`status`/`export` commands
- `src/cdk-diff.ts` — CDK-specific changeset generation and async polling
- `src/generate.ts` — File generation for testing/demos

**The `ApiClient` interface — why it matters for testing:**
```typescript
interface ApiClient {
  submitAnalysis(payload, options): Promise<AnalysisResult>;
  getStatus(analysisId): Promise<AnalysisStatus>;
  getExport(analysisId, format): Promise<AnalysisResult>;
}
```
In production, makes HTTP calls to the real API. In tests, inject a mock that returns fake data. The CLI's 37 tests run instantly with zero network calls.

**API request options:** The CLI sends `enableSummary: true` by default in the options payload (unless `--no-summary` is specified). This controls whether the pipeline runs the SummaryGeneration step.

**No AWS SDK dependency:** The `cdk-diff` and `generate` commands shell out to the AWS CLI for CloudFormation operations. This keeps the package lightweight and avoids bundling the SDK.

**Environment:** Needs `BLAST_RADIUS_API_URL` set to the API Gateway endpoint URL.
