# CLI Release & GitHub Action — TODO

## 1. Bundle CLI into a single file

Use `esbuild` to produce a self-contained executable that includes `@blast-radius/core`.

```bash
# Add to packages/cli/package.json scripts:
"bundle": "esbuild src/index.ts --bundle --platform=node --target=node20 --outfile=bin/blast-radius.js --banner:js='#!/usr/bin/env node'"
```

- Single file, no `node_modules` needed
- Works on any machine with Node.js 20+
- Include `cdk-diff.ts` and `generate.ts` (they're imported by index.ts)

## 2. GitHub Release

Create a release workflow (`.github/workflows/release.yml`):

```yaml
name: Release CLI
on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm run build --workspace=packages/core
      - run: npm run bundle --workspace=packages/cli

      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          files: packages/cli/bin/blast-radius.js
          generate_release_notes: true
```

Users download from: `https://github.com/sburgholzer/BlastRadius/releases/latest/download/blast-radius.js`

## 3. GitHub Action

Create a reusable action at `.github/actions/blast-radius/action.yml`:

```yaml
name: 'Blast Radius Analysis'
description: 'Analyze CDK/CloudFormation/Terraform changes for blast radius risk'
inputs:
  command:
    description: 'Command to run (cdk-diff, analyze)'
    default: 'cdk-diff'
  stack:
    description: 'CloudFormation stack name (for cdk-diff)'
    required: false
  format:
    description: 'Input format (for analyze)'
    required: false
  input:
    description: 'Input file path (for analyze)'
    required: false
  threshold:
    description: 'Risk threshold (0-100)'
    required: false
  api-url:
    description: 'Blast Radius API URL'
    required: true
  no-summary:
    description: 'Disable AI summary'
    default: 'false'

outputs:
  analysis-id:
    description: 'The analysis ID'
  verdict:
    description: 'pass or fail'
  highest-score:
    description: 'Highest impact score'
  summary:
    description: 'AI-generated risk summary (markdown)'

runs:
  using: 'composite'
  steps:
    - name: Download CLI
      shell: bash
      run: |
        curl -sL https://github.com/sburgholzer/BlastRadius/releases/latest/download/blast-radius.js -o ${{ runner.temp }}/blast-radius.js
        chmod +x ${{ runner.temp }}/blast-radius.js

    - name: Run Analysis
      id: analysis
      shell: bash
      env:
        BLAST_RADIUS_API_URL: ${{ inputs.api-url }}
      run: |
        ARGS="${{ inputs.command }}"
        [ -n "${{ inputs.stack }}" ] && ARGS="$ARGS --stack ${{ inputs.stack }}"
        [ -n "${{ inputs.format }}" ] && ARGS="$ARGS --format ${{ inputs.format }}"
        [ -n "${{ inputs.input }}" ] && ARGS="$ARGS --input ${{ inputs.input }}"
        [ -n "${{ inputs.threshold }}" ] && ARGS="$ARGS --threshold ${{ inputs.threshold }}"
        [ "${{ inputs.no-summary }}" = "true" ] && ARGS="$ARGS --no-summary"
        ARGS="$ARGS --ci"

        node ${{ runner.temp }}/blast-radius.js $ARGS > result.json
        echo "exit-code=$?" >> $GITHUB_OUTPUT

        # Parse outputs
        echo "analysis-id=$(jq -r '.analysisId // empty' result.json)" >> $GITHUB_OUTPUT
        echo "verdict=$(jq -r '.verdict // empty' result.json)" >> $GITHUB_OUTPUT
        echo "highest-score=$(jq -r '.riskSummary.highestScore // empty' result.json)" >> $GITHUB_OUTPUT

        # Multi-line summary
        echo "summary<<EOF" >> $GITHUB_OUTPUT
        jq -r '.naturalLanguageSummary // empty' result.json >> $GITHUB_OUTPUT
        echo "EOF" >> $GITHUB_OUTPUT
```

## 4. Usage in other repos

```yaml
# .github/workflows/deploy.yml
jobs:
  blast-radius:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: sburgholzer/BlastRadius/.github/actions/blast-radius@v1
        id: blast
        with:
          command: cdk-diff
          stack: MyProductionStack
          threshold: 75
          api-url: ${{ secrets.BLAST_RADIUS_API_URL }}

      - name: Comment PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const verdict = '${{ steps.blast.outputs.verdict }}' === 'pass' ? '✅' : '❌';
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## ${verdict} Blast Radius Analysis\n\n${{ steps.blast.outputs.summary }}`
            });
```

## Dependencies

- `esbuild` (dev dependency in packages/cli)
- Node.js 20+ on the runner
- AWS CLI configured (for cdk-diff changeset operations)
- CDK CLI (if using cdk-diff with --app)
