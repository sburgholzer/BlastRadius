← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# CLI (packages/cli)

A single program for CI/CD pipeline integration. Auto-generates changesets/plans for each IaC tool, submits for analysis, polls for results, and evaluates deployment gates.

```bash
blast-radius analyze --format <format> [options]
```

## Supported Formats

| Format | Auto-generates? | Requirements |
|--------|----------------|--------------|
| `cdk` | ✅ | `--stack` (runs `cdk synth` + creates CloudFormation changeset) |
| `cloudformation` | ✅ | `--stack` + `--template` (creates changeset from template) |
| `terraform-plan` | ✅ | None — runs `terraform plan` + `terraform show -json` in cwd |
| `canonical` | ❌ | `--input` required (already in final format) |

If `--input` is provided, auto-generation is skipped for any format.

## Commands

### `analyze` — Submit and evaluate

The main command. Generates input (if needed), submits to the API, polls for results, evaluates gates.

```bash
# CDK — auto-generates changeset
blast-radius analyze --format cdk --stack MyStack --ai-gate

# CloudFormation — creates changeset from template
blast-radius analyze --format cloudformation --stack MyStack --template cfn.json --threshold 75

# Terraform — auto-runs terraform plan
blast-radius analyze --format terraform-plan --ai-gate --ci

# Pre-built file (any format)
blast-radius analyze --format terraform-plan --input plan.json --threshold 80

# Save generated input + submit
blast-radius analyze --format cdk --stack MyStack --save changeset.json --ai-gate
```

**All options:**

| Flag | Description |
|------|-------------|
| `--format <format>` | Input format: `cdk`, `cloudformation`, `terraform-plan`, `canonical` |
| `--input <file>` | Input file (skips auto-generation) |
| `--stack <name>` | Stack name (CDK/CloudFormation) |
| `--app <command>` | CDK app command (optional, reads `cdk.json` if omitted) |
| `--template <file>` | CloudFormation template file |
| `--threshold <0-100>` | Risk score threshold for pass/fail |
| `--ai-gate` | Fail if AI recommends against deployment |
| `--no-summary` | Skip AI summary generation |
| `--save <file>` | Save generated input to file before submitting |
| `--ci` | Machine-readable JSON output |
| `--region <region>` | AWS region |
| `--profile <profile>` | AWS profile |

### `generate` — Create input files only

Produces input files for testing, demos, or later use with `analyze --input`. Does not submit.

```bash
blast-radius generate --format cdk --stack MyStack --output changeset.json
blast-radius generate --format terraform-plan --output plan.json
blast-radius generate --format cloudformation --stack MyStack --template cfn.json --output changeset.json
```

### `status` — Check running analysis

```bash
blast-radius status --analysis-id abc-123
```

### `export` — Fetch completed results

```bash
blast-radius export --analysis-id abc-123 --format json
```

### `cdk-diff` — Alias

Shorthand for `analyze --format cdk`. Kept for backward compatibility.

```bash
blast-radius cdk-diff --stack MyStack --ai-gate
# Equivalent to: blast-radius analyze --format cdk --stack MyStack --ai-gate
```

## Deployment Gates

Two independent gates that can be used separately or together:

**Threshold gate (`--threshold`):** Numeric score-based. Fails if any resource's impact score exceeds the threshold. Deterministic, fast, no AI needed.

**AI gate (`--ai-gate`):** Judgment-based. The AI analyzes cascading risks, single points of failure, and dependency patterns. Returns `recommendDeploy: true/false` with a confidence level (`high`, `medium`, `low`). Note: `--ai-gate` forces AI summary generation even if `--no-summary` is specified (the gate requires it). If the server has Bedrock disabled (`enableBedrockSummary: false` in CDK stack props), the CLI exits with error code 2 explaining the misconfiguration.

```bash
# Threshold only
blast-radius analyze --format cdk --stack MyStack --threshold 75

# AI gate only
blast-radius analyze --format cdk --stack MyStack --ai-gate

# Both — fails if EITHER triggers
blast-radius analyze --format cdk --stack MyStack --threshold 75 --ai-gate
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Pass — threshold OK and AI approves (or gates not enabled) |
| 1 | Fail — threshold exceeded OR AI recommends against deployment |
| 2 | Error — invalid input, pipeline failure, timeout |

## CI/CD Output

With `--ci`, output is JSON containing everything needed for PR comments and gate decisions:

```json
{
  "analysisId": "abc-123",
  "verdict": "fail",
  "exitCode": 1,
  "reason": "ai-gate",
  "recommendDeploy": false,
  "confidence": "high",
  "riskSummary": { "highestScore": 65, "totalAffected": 10, "critical": 0, "high": 10 },
  "naturalLanguageSummary": "## Executive Overview\n\nThis deployment presents..."
}
```

## CI/CD Integration Examples

### GitHub Action (recommended)

The easiest way — use the published action directly. Users generate their own changeset/plan in prior steps (they already have CDK/Terraform installed), then pass the file to the action:

```yaml
# CDK example
- run: npm install
- run: |
    npx cdk synth 2>/dev/null
    cp cdk.out/MyStack.template.json template.json
    CHANGESET_NAME="blast-radius-$(date +%s)"
    aws cloudformation create-change-set \
      --stack-name MyStack --change-set-name $CHANGESET_NAME \
      --template-body file://template.json \
      --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
      --change-set-type UPDATE --output json
    aws cloudformation wait change-set-create-complete \
      --stack-name MyStack --change-set-name $CHANGESET_NAME
    aws cloudformation describe-change-set \
      --stack-name MyStack --change-set-name $CHANGESET_NAME \
      --output json > changeset.json
    aws cloudformation delete-change-set \
      --stack-name MyStack --change-set-name $CHANGESET_NAME

- uses: sburgholzer/BlastRadius@v0.1.0
  with:
    format: cloudformation
    input: changeset.json
    threshold: 75
    ai-gate: true
    api-url: ${{ secrets.BLAST_RADIUS_URL }}
```

```yaml
# Terraform example
- run: terraform plan -out=plan.out
- run: terraform show -json plan.out > plan.json

- uses: sburgholzer/BlastRadius@v0.1.0
  with:
    format: terraform-plan
    input: plan.json
    ai-gate: true
    api-url: ${{ secrets.BLAST_RADIUS_URL }}
```

The action automatically comments on the PR with a formatted table and AI summary (disable with `comment-pr: false`).

**Action inputs:**
| Input | Required | Description |
|-------|----------|-------------|
| `format` | ✅ | `cloudformation`, `terraform-plan`, or `canonical` |
| `input` | ✅ | Path to the input file |
| `threshold` | | Risk score threshold (0-100) |
| `ai-gate` | | Fail if AI recommends against deployment |
| `no-summary` | | Skip AI summary |
| `api-url` | ✅ | Blast Radius API URL |
| `comment-pr` | | Auto-comment on PR (default: `true`) |
| `version` | | CLI version (default: `latest`) |

**Action outputs:**
| Output | Description |
|--------|-------------|
| `analysis-id` | The analysis ID |
| `verdict` | `pass` or `fail` |
| `highest-score` | Highest impact score (0-100) |
| `total-affected` | Total affected resources |
| `recommend-deploy` | AI recommendation (`true`/`false`) |
| `confidence` | AI confidence (`high`/`medium`/`low`) |
| `summary` | AI-generated markdown summary |
| `result-json` | Full JSON result |

### CLI directly (any CI system)

Download the bundled CLI from the GitHub release:

**GitHub Actions:**
```yaml
- run: |
    curl -sL https://github.com/sburgholzer/BlastRadius/releases/latest/download/blast-radius.js -o blast-radius.js
    sed -i '1{/^#!/d}' blast-radius.js
    node blast-radius.js analyze --format cloudformation --input changeset.json --ai-gate --ci
  env:
    BLAST_RADIUS_API_URL: ${{ secrets.BLAST_RADIUS_URL }}
```

**GitLab CI:**
```yaml
blast-radius:
  script:
    - curl -sL https://github.com/sburgholzer/BlastRadius/releases/latest/download/blast-radius.js -o blast-radius.js
    - sed -i '1{/^#!/d}' blast-radius.js
    - node blast-radius.js analyze --format terraform-plan --input plan.json --ai-gate --ci
```

**Jenkins:**
```groovy
stage('Blast Radius') {
  sh '''
    curl -sL https://github.com/sburgholzer/BlastRadius/releases/latest/download/blast-radius.js -o blast-radius.js
    sed -i '1{/^#!/d}' blast-radius.js
    node blast-radius.js analyze --format cloudformation --input changeset.json --threshold 75 --ai-gate --ci
  '''
}
```

## Polling and Stale Detection

After submitting, the CLI polls every 3 seconds (up to 120s). Includes stale detection: if `updatedAt` is unchanged for 5 consecutive polls (~15s), assumes silent failure and reports error.

## Architecture

**Source files:**
- `src/index.ts` — Main entry, argument parsing, `analyze`/`status`/`export` commands, polling logic
- `src/input-generators.ts` — Auto-generation for CDK, CloudFormation, Terraform
- `src/cdk-diff.ts` — Legacy CDK-specific handler (kept for reference)
- `src/generate.ts` — File generation without submission

**No AWS SDK dependency:** Shells out to AWS CLI and CDK/Terraform CLIs for generation. Keeps the package lightweight.

**Environment:** Needs `BLAST_RADIUS_API_URL` set to the API Gateway endpoint URL.
