# Architecture Walkthrough

A guided tour of the Blast Radius codebase, following the data flow from user submission to visualization.

## The Big Picture

```
User submits changeset (via CLI or frontend)
    → API Gateway receives request
    → Step Functions pipeline starts:
        → Is format "canonical"?
            No → Adapter converts to canonical format
            Yes → Skip adapter
        → Ingestion validates the manifest
        → Progress update (20%)
        → Resource Resolver discovers dependencies (AWS Config)
        → Progress update (40%)
        → Risk Assessor scores each resource
        → Progress update (60%)
        → Visualization Prep formats for frontend + S3
        → Progress update (80%)
        → Is enableSummary = true?
            Yes → Risk Summary generates AI explanation
            No → Skip summary
        → Mark analysis complete (100%)
    → User sees interactive graph + AI summary
```

## Pipeline Error Handling

Every task state in the pipeline catches `States.ALL` errors. On failure:
1. `UpdateStatusFailed` — invokes the status Lambda to mark the analysis as "failed" in DynamoDB
2. `PipelineFailed` — the Fail state terminates the execution

This guarantees the frontend never shows a permanently "running" analysis.

## State Preservation Between Steps

The pipeline uses `resultPath` (not `outputPath`) for Discovery, Scoring, and VisualizationPrep. This preserves the full state object while adding each step's output under a new key:

```
After Ingestion:    { analysisId, sourceFormat, validatedManifest, options }
After Discovery:    { ...above, discoveryResult: { dependencyGraph, coverage } }
After Scoring:      { ...above, scoringResult: { scoredResources, riskSummary } }
After VisPrep:      { ...above, visualizationResult: { ... } }
```

## Table of Contents

| Section | File |
|---------|------|
| **Concepts** | |
| Canonical Format | [concepts/canonical-format.md](./concepts/canonical-format.md) |
| Dependency Injection | [concepts/dependency-injection.md](./concepts/dependency-injection.md) |
| Discriminated Unions | [concepts/discriminated-unions.md](./concepts/discriminated-unions.md) |
| **Layer 1: Core** | |
| Manifest Model | [core/manifest.md](./core/manifest.md) |
| Dependency Graph | [core/dependency-graph.md](./core/dependency-graph.md) |
| Scored Resource & Risk Formula | [core/scored-resource.md](./core/scored-resource.md) |
| Manifest Validator | [core/manifest-validator.md](./core/manifest-validator.md) |
| LRU Cache | [core/lru-cache.md](./core/lru-cache.md) |
| Threshold Evaluator | [core/threshold-evaluator.md](./core/threshold-evaluator.md) |
| Criticality Map | [core/criticality-map.md](./core/criticality-map.md) |
| Retry Logic | [core/retry.md](./core/retry.md) |
| Access Scoper | [core/access-scoper.md](./core/access-scoper.md) |
| **Layer 2: Lambdas** | |
| Ingestion Handler | [lambdas/ingestion.md](./lambdas/ingestion.md) |
| Adapter Registry | [lambdas/adapter-registry.md](./lambdas/adapter-registry.md) |
| CloudFormation Adapter | [lambdas/adapter-cloudformation.md](./lambdas/adapter-cloudformation.md) |
| Terraform Adapter | [lambdas/adapter-terraform.md](./lambdas/adapter-terraform.md) |
| CDK Adapter | [lambdas/adapter-cdk.md](./lambdas/adapter-cdk.md) |
| Resource Resolver | [lambdas/resource-resolver.md](./lambdas/resource-resolver.md) |
| Risk Assessor | [lambdas/risk-assessor.md](./lambdas/risk-assessor.md) |
| Visualization Prep | [lambdas/visualization-prep.md](./lambdas/visualization-prep.md) |
| Risk Summary | [lambdas/risk-summary.md](./lambdas/risk-summary.md) |
| Status Handler | [lambdas/status.md](./lambdas/status.md) |
| Failure Handler | [lambdas/failure-handler.md](./lambdas/failure-handler.md) |
| Results Handler | [lambdas/results.md](./lambdas/results.md) |
| **Layer 3: Frontend** | [frontend/overview.md](./frontend/overview.md) |
| **Layer 4: CLI** | [cli/overview.md](./cli/overview.md) |
| **Layer 5: Infra** | [infra/overview.md](./infra/overview.md) |

## Suggested Reading Order

1. [Canonical Format](./concepts/canonical-format.md) — Understand the core idea
2. [Manifest Model](./core/manifest.md) — The data shape
3. [Scored Resource](./core/scored-resource.md) — The scoring formula
4. [Resource Resolver](./lambdas/resource-resolver.md) — The most complex handler
5. [Terraform Adapter](./lambdas/adapter-terraform.md) — How format conversion works
6. [CLI](./cli/overview.md) — How CI/CD integration works
7. [Infra](./infra/overview.md) — How it all connects in AWS
