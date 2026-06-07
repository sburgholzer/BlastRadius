# Blast Radius Visualizer — Project Steering

## Overview

Serverless system that analyzes IaC changesets (CloudFormation, CDK, Terraform, Pulumi) before deployment to discover downstream resource dependencies, compute risk scores, and present an interactive dependency graph.

Architecture: API Gateway → Lambda → Step Functions → Lambda chain → S3/DynamoDB → React frontend via CloudFront.

## Tech Stack

- TypeScript 5.4+ (strict mode, ES2022 target, NodeNext modules)
- Node.js 20+ runtime, AWS Lambda (Node.js 22, ARM64)
- npm workspaces monorepo
- AWS CDK for infrastructure
- Vitest + fast-check for testing (property-based tests)
- Zod for schema validation
- AWS SDK v3 (@aws-sdk/*)
- React + Vite + Cytoscape.js for frontend

## Monorepo Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@blast-radius/core` | packages/core | Shared models, validation, cache, retry, verdict, auth |
| `@blast-radius/lambdas` | packages/lambdas | Lambda handlers for the analysis pipeline |
| `@blast-radius/frontend` | packages/frontend | React SPA with Cytoscape.js graph |
| `@blast-radius/cli` | packages/cli | CLI tool for CI/CD integration |
| `@blast-radius/infra` | packages/infra | CDK infrastructure stack |

## Commands

- `npm run build` — Build all workspaces
- `npm test` — Run all tests (vitest run)
- `npm run lint` — ESLint across all packages
- `npm run format` — Prettier write
- `npm run format:check` — Prettier check

## Code Conventions

### Formatting (Prettier)

- Single quotes, semicolons, trailing commas (all)
- Print width: 100, tab width: 2
- Arrow parens: always

### Import Ordering

Enforced by eslint-plugin-import:

```
builtin → external → internal → parent → sibling → index
```

Newlines between groups, alphabetized within each group.

### TypeScript

- Strict mode — no implicit any, strict null checks
- Prefer `export type` for interfaces and type aliases
- Use path aliases: `@blast-radius/core`, `@blast-radius/lambdas`, `@blast-radius/cli`
- Unused variables error with `_` prefix exception for intentionally unused args
- `@typescript-eslint/no-explicit-any` is a warning — avoid `any` where possible

### Dependency Injection

Lambda handlers that call AWS services accept an optional `deps` parameter:

```typescript
export async function handler(event: InputType, deps?: HandlerDeps): Promise<ResultType> {
  const { dynamoClient, s3Client } = deps && 'dynamoClient' in deps ? deps : createDefaultDeps();
  // ...
}
```

- Production: `deps` is the Lambda Context object (truthy but wrong shape), so we check for a known key
- Tests: pass mock clients directly — no module mocking needed
- IMPORTANT: Use `deps && 'keyName' in deps` NOT `deps ?? createDefaultDeps()` — the Lambda runtime passes the Context object as the second argument which is truthy

### Result Types (Discriminated Unions)

Use discriminated unions for success/failure results:

```typescript
type ValidationResult =
  | { success: true; manifest: ResourceChangeManifest }
  | { success: false; errors: ValidationError[] };
```

### Error Handling

- Structured error categories: retryable (throttling, transient) vs non-retryable (validation, access denied)
- Use the `withRetry` utility from `@blast-radius/core` for AWS service calls
- On persistent failure, mark resources as unknown coverage and continue processing

### JSDoc

- Module-level doc comments with `@module` tag
- Reference requirements with `@see Requirement X.Y`
- Keep inline comments minimal — code should be self-documenting

## Testing Conventions

- Framework: Vitest with globals enabled (no explicit imports of describe/it/expect needed)
- Property-based tests: fast-check with custom arbitraries, minimum 100 runs per property
- Test files: co-located with source as `*.spec.ts` or `*.test.ts`
- Test naming pattern: `Feature: blast-radius-visualizer, Property {N}: {title}`
- Coverage: v8 provider
- Mock pattern: use dependency injection, not `vi.mock()` for AWS clients

## Architecture Notes

- Canonical manifest format is the core abstraction — all IaC tools convert to it via adapters
- Pipeline order: NeedsAdapterConversion → (AdapterConversion → PrepareAfterAdapter →) Ingestion → ProgressUpdate → Discovery → ProgressUpdate → Scoring → ProgressUpdate → VisualizationPrep → ProgressUpdate → NeedsSummaryGeneration → (SummaryGeneration →) MarkAnalysisComplete → Complete
- Progress percentages: 20% (post-ingestion), 40% (post-discovery), 60% (post-scoring), 80% (post-visualization), 100% (complete)
- The adapter choice runs BEFORE ingestion because `$.sourceFormat` is only available in the original input
- Adapter handlers must be `async` — Node.js 22 Lambda runtime returns `null` for synchronous handlers
- Discovery, Scoring, VisualizationPrep use `resultPath` to preserve state between steps (not `outputPath`)
- Scoring gets explicit payload: `{ dependencyGraph: $.discoveryResult.dependencyGraph, manifest: $.validatedManifest }`
- VisualizationPrep gets: `{ analysisId, dependencyGraph, scoredResources, riskSummary, manifest }`
- SummaryGeneration gets: `{ analysisId, scoredResources, riskSummary, manifest }`
- NeedsSummaryGeneration uses `Condition.and(isPresent('$.options.enableSummary'), booleanEquals(...))` to avoid crash on missing field
- Risk scoring formula: `(depthScore × 0.30) + (criticalityScore × 0.40) + (changeTypeSeverity × 0.30)`
- Dependency discovery uses AWS Config (`CONFIG_AGGREGATOR_NAME` env var) and Resource Explorer
- Config relationships with missing `resourceId` are filtered out (prevents orphan nodes and dangling edges)
- Results stored in S3, analysis status tracked in DynamoDB
- Multi-tenancy via IAM-based access scoping
- Frontend resolves API URL at runtime from `/config.json` (deployed by CDK) — works for both auth and no-auth modes
- Adapter registry table is seeded automatically on CDK deploy via AwsCustomResource
- Pipeline failures: all task states catch States.ALL → UpdateStatusFailed (marks "failed" in DynamoDB) → PipelineFailed (Fail state)
- API handler maps visualization format (nodes/edges) to frontend format (scoredResources/dependencyGraph), filters orphan nodes and dangling edges
- Risk summary Lambda writes the generated summary back to S3 visualization.json
- Risk summary checks both `ENABLE_BEDROCK_SUMMARY` and `ENABLE_BEDROCK` env vars, uses inference profile model ID

## CLI

- Five commands: `analyze`, `cdk-diff`, `generate`, `status`, `export`
- `cdk-diff` synthesizes CDK, creates/describes/deletes a read-only changeset, submits for analysis, polls with stale detection
- `generate` produces input files for testing/demos from CDK, CloudFormation, or Terraform
- Polling stale detection: if `updatedAt` unchanged for 5 polls (~15s), assumes failure
- CI output includes: `analysisId`, `riskSummary`, `naturalLanguageSummary`, `verdict`
- `enableSummary` sent in API request options (defaults to true, disabled with `--no-summary`)

## Documentation

Comprehensive docs live in `docs/` with an architecture walkthrough at `docs/architecture-walkthrough.md`. Read the suggested reading order there when onboarding to the codebase.
