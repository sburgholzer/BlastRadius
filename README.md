# 🎯 Blast Radius — AWS Infrastructure Risk Analysis

Analyze the blast radius of AWS infrastructure changes before deployment. Discovers downstream dependencies via AWS Config, scores impact, and provides AI-powered deployment recommendations.

[![GitHub Action](https://img.shields.io/badge/GitHub%20Action-Marketplace-blue?logo=github)](https://github.com/marketplace/actions/blast-radius-aws-infrastructure-risk-analysis)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.md)

## Quick Start — GitHub Action

> **⚠️ Requires a Blast Radius backend deployed to your AWS account.** The CLI and Action submit analyses to your backend API. See [Deploy Your Own Backend](#deploy-your-own-backend) for setup (one `cdk deploy` command).

Generate your changeset/plan in your workflow, then pass the file to the action:

```yaml
# CDK example
- run: npm install
- run: |
    npx cdk synth 2>/dev/null
    cp cdk.out/MyStack.template.json template.json
    CHANGESET="blast-radius-$(date +%s)"
    aws cloudformation create-change-set --stack-name MyStack --change-set-name $CHANGESET \
      --template-body file://template.json --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
      --change-set-type UPDATE --output json
    aws cloudformation wait change-set-create-complete --stack-name MyStack --change-set-name $CHANGESET
    aws cloudformation describe-change-set --stack-name MyStack --change-set-name $CHANGESET --output json > changeset.json
    aws cloudformation delete-change-set --stack-name MyStack --change-set-name $CHANGESET

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
- run: terraform plan -out=plan.out && terraform show -json plan.out > plan.json

- uses: sburgholzer/BlastRadius@v0.1.0
  with:
    format: terraform-plan
    input: plan.json
    ai-gate: true
    api-url: ${{ secrets.BLAST_RADIUS_URL }}
```

The action automatically comments on the PR with results. Disable with `comment-pr: false`.

**Outputs:** `verdict`, `highest-score`, `total-affected`, `recommend-deploy`, `confidence`, `summary`

## Quick Start — CLI

```bash
# Download
curl -sL https://github.com/sburgholzer/BlastRadius/releases/latest/download/blast-radius.js -o blast-radius.js
chmod +x blast-radius.js

# CDK — auto-generates changeset
BLAST_RADIUS_API_URL=<your-url> ./blast-radius.js analyze --format cdk --stack MyStack --ai-gate

# Terraform — auto-runs terraform plan
BLAST_RADIUS_API_URL=<your-url> ./blast-radius.js analyze --format terraform-plan --threshold 75

# CloudFormation — from template
BLAST_RADIUS_API_URL=<your-url> ./blast-radius.js analyze --format cloudformation --stack MyStack --template cfn.json
```

**Exit codes:** `0` = pass, `1` = fail (threshold or AI gate), `2` = error

## How It Works

```
Your IaC change
  → Auto-generates changeset (CDK synth, terraform plan, etc.)
  → Adapter converts to canonical format
  → AWS Config discovers downstream dependencies
  → Risk Assessor scores each affected resource
  → AI analyzes patterns and recommends deploy/no-deploy
  → Results displayed in CLI, PR comment, or interactive frontend
```

## Features

| Feature | Description |
|---------|-------------|
| **Multi-format** | CDK, CloudFormation, Terraform (auto-generates changesets) |
| **Dependency discovery** | AWS Config + Resource Explorer for real relationship data |
| **Risk scoring** | Impact 0-100 based on depth, criticality, and change severity |
| **AI deployment gate** | Claude-powered recommendation with confidence level |
| **Threshold gate** | Numeric score threshold for deterministic pass/fail |
| **Interactive frontend** | Cytoscape.js graph with filtering, zoom, export |
| **CI/CD native** | GitHub Action + JSON output for any CI system |

## Deployment Gates

Two independent gates — use one or both:

```bash
# Threshold only (deterministic, fast)
blast-radius analyze --format cdk --stack MyStack --threshold 75

# AI gate only (judgment-based, catches patterns)
blast-radius analyze --format cdk --stack MyStack --ai-gate

# Both — fails if EITHER triggers
blast-radius analyze --format cdk --stack MyStack --threshold 75 --ai-gate
```

The AI gate catches things thresholds can't — like 10 resources all depending on a single security group (score 65, but systemic risk). The AI sees the pattern and says "don't deploy."

## Architecture

```
API Gateway → Step Functions Pipeline:
  → Adapter Conversion (conditional)
  → Ingestion & Validation
  → Resource Resolver (AWS Config queries)
  → Risk Assessor (scoring formula)
  → Visualization Prep (S3 storage)
  → AI Summary (Bedrock, conditional)
  → Complete
```

**Stack:** TypeScript, AWS CDK, Lambda (Node.js 22), Step Functions, DynamoDB, S3, CloudFront, Bedrock

## Deploy Your Own Backend

### Prerequisites

- AWS account with [Config](https://docs.aws.amazon.com/config/latest/developerguide/), [Resource Explorer](https://docs.aws.amazon.com/resource-explorer/), and [CDK Bootstrap](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html) enabled
- Node.js 20+
- Optional: [Bedrock model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html) for AI summaries

### Deploy

```bash
git clone https://github.com/sburgholzer/BlastRadius.git
cd BlastRadius
npm install
npm run build
cd packages/infra
cdk deploy
```

### Configuration

```typescript
new BlastRadiusStack(app, 'BlastRadiusStack', {
  enableBedrockSummary: true,   // AI summaries (requires Bedrock access)
  resultsRetentionDays: 90,     // S3 lifecycle
  enableAuth: false,            // true = IAM SigV4, false = open (demos)
});
```

## Project Structure

```
├── action.yml              # GitHub Action definition
├── packages/
│   ├── core/               # Shared models, validation, scoring
│   ├── lambdas/            # Lambda handlers (adapters, resolver, assessor, etc.)
│   ├── frontend/           # React SPA with Cytoscape.js
│   ├── cli/                # CLI tool (bundled as single file for releases)
│   └── infra/              # CDK infrastructure stack
├── examples/
│   ├── cdk-demo/           # Two-step CDK demo (baseline + risky change)
│   └── mock-server/        # Local mock for frontend development
└── docs/                   # Architecture walkthrough and API docs
```

## Risk Scoring

```
Impact_Score = (depthScore × 0.30) + (criticalityScore × 0.40) + (changeTypeSeverity × 0.30)
```

| Category | Score Range |
|----------|-------------|
| Critical | 75-100 |
| High | 50-74 |
| Medium | 25-49 |
| Low | 0-24 |

## Documentation

- [Architecture Walkthrough](docs/architecture-walkthrough.md)
- [CLI Reference](docs/cli/overview.md)
- [Infrastructure](docs/infra/overview.md)
- [Frontend](docs/frontend/overview.md)
- [CDK Demo](examples/cdk-demo/README.md)

## Development

```bash
npm install         # Install all workspace dependencies
npm run build       # Build all packages
npm test            # Run all 349 tests
npm run lint        # ESLint
npm run format      # Prettier
```

## License

[MIT](LICENSE.md) — Copyright (c) 2025 Scott Burgholzer
