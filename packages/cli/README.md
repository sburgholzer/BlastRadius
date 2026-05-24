# @blast-radius/cli

Command-line tool for integrating Blast Radius analysis into CI/CD pipelines. Submits manifests for analysis, evaluates risk thresholds, and returns structured exit codes for pipeline gating.

## Installation

```bash
# From the monorepo root
npm install
npm run build --workspace=packages/cli

# The binary is available at:
./packages/cli/dist/index.js

# Or link globally:
npm link --workspace=packages/cli
blast-radius --help
```

---

## Commands

### analyze

Submit a manifest or changeset for blast radius analysis.

```bash
blast-radius analyze [--format <format>] [--input <file>] [--threshold <0-100>] [--ci]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--format` | Source format identifier (canonical, cloudformation, terraform, cdk) | `canonical` |
| `--input` | Path to input file (alternative to stdin) | stdin |
| `--threshold` | Risk threshold for pass/fail verdict (integer 0–100) | none (no gating) |
| `--ci` | Output JSON instead of human-readable text | `false` |

**Input methods:**
- File path: `blast-radius analyze --input changeset.json`
- Stdin pipe: `cat changeset.json | blast-radius analyze`
- Terraform: `terraform show -json plan.out | blast-radius analyze --format terraform`

**Behavior:**
- Without `--threshold`: Returns full analysis results (exit 0)
- With `--threshold`: Evaluates pass/fail verdict based on whether any resource exceeds the threshold

### status

Check the current status of a running analysis.

```bash
blast-radius status --analysis-id <id>
```

| Flag | Description | Required |
|------|-------------|----------|
| `--analysis-id` | The analysis ID returned from the analyze command | Yes |

### export

Export completed analysis results.

```bash
blast-radius export --analysis-id <id> [--format json|pdf]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--analysis-id` | The analysis ID to export | Required |
| `--format` | Export format (json or pdf) | `json` |

---

## Exit Codes

| Code | Meaning | When |
|------|---------|------|
| 0 | Pass | No resource exceeds the risk threshold (or no threshold specified) |
| 1 | Fail | One or more resources exceed the risk threshold |
| 2 | Error | Invalid input, API failure, timeout, or invalid threshold |

---

## Output Formats

### Human-readable (default)

```
✓ PASS - No resources exceed the risk threshold.
  Total affected resources: 12
  Highest impact score: 68
```

```
✗ FAIL - Resources exceed the risk threshold.
  Total affected: 12
  Exceeding threshold: 3
  Highest impact score: 92

Resources exceeding threshold:
  - arn:aws:rds:us-east-1:123:db/prod (AWS::RDS::DBInstance) score=92 [Critical]
  - arn:aws:ecs:us-east-1:123:service/api (AWS::ECS::Service) score=81 [Critical]
  - arn:aws:lambda:us-east-1:123:function:auth (AWS::Lambda::Function) score=76 [Critical]
```

### JSON (--ci mode)

```json
{
  "verdict": "fail",
  "exitCode": 1,
  "exceedingResources": [
    {
      "resourceId": "arn:aws:rds:us-east-1:123:db/prod",
      "resourceType": "AWS::RDS::DBInstance",
      "impactScore": 92,
      "riskCategory": "Critical",
      "dependencyChain": ["sg-abc123", "eni-def456", "arn:aws:rds:us-east-1:123:db/prod"]
    }
  ],
  "summary": {
    "totalAffected": 12,
    "highestScore": 92,
    "exceedingCount": 3
  }
}
```

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BLAST_RADIUS_API_URL` | Base URL of the Blast Radius API | Yes |

---

## CI/CD Integration Examples

### GitHub Actions

```yaml
name: Blast Radius Check
on: [pull_request]

jobs:
  blast-radius:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Generate Terraform Plan
        run: |
          terraform init
          terraform plan -out=plan.out
          terraform show -json plan.out > plan.json

      - name: Run Blast Radius Analysis
        env:
          BLAST_RADIUS_API_URL: ${{ secrets.BLAST_RADIUS_API_URL }}
        run: |
          blast-radius analyze \
            --format terraform \
            --input plan.json \
            --threshold 75 \
            --ci
```

### GitLab CI

```yaml
blast-radius:
  stage: validate
  script:
    - terraform plan -out=plan.out
    - terraform show -json plan.out > plan.json
    - blast-radius analyze --format terraform --input plan.json --threshold 75 --ci
  variables:
    BLAST_RADIUS_API_URL: $BLAST_RADIUS_API_URL
  allow_failure: false
```

### Jenkins

```groovy
pipeline {
    agent any
    environment {
        BLAST_RADIUS_API_URL = credentials('blast-radius-api-url')
    }
    stages {
        stage('Blast Radius') {
            steps {
                sh '''
                    terraform show -json plan.out > plan.json
                    blast-radius analyze \
                        --format terraform \
                        --input plan.json \
                        --threshold 75 \
                        --ci
                '''
            }
        }
    }
}
```

### AWS CodePipeline (buildspec)

```yaml
version: 0.2
phases:
  build:
    commands:
      - terraform show -json plan.out > plan.json
      - blast-radius analyze --format terraform --input plan.json --threshold 75 --ci
```

---

## Architecture

The CLI uses an `ApiClient` interface for all backend communication, making it fully testable without network calls:

```typescript
interface ApiClient {
  submitAnalysis(payload: unknown, options: AnalyzeOptions): Promise<AnalysisResult>;
  getStatus(analysisId: string): Promise<AnalysisStatus>;
  getExport(analysisId: string, format: string): Promise<AnalysisResult>;
}
```

Tests inject a mock `ApiClient` to verify CLI behavior in isolation:

```typescript
const mockClient: ApiClient = {
  submitAnalysis: async () => mockResult,
  getStatus: async () => mockStatus,
  getExport: async () => mockResult,
};

const output = await main(['node', 'blast-radius', 'analyze', '--ci'], mockClient);
expect(output.exitCode).toBe(0);
```

---

## Dependencies

- `@blast-radius/core` — Shared types, `evaluateThreshold`, `validateThreshold`

## Scripts

```bash
npm run build   # TypeScript compilation
npm run clean   # Remove dist/
```
