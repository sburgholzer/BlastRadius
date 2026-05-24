# Implementation Plan: Blast Radius Pre-Deploy Visualizer

## Overview

This plan implements the Blast Radius Pre-Deploy Visualizer as a serverless TypeScript application on AWS. The system uses AWS CDK for infrastructure, Lambda functions for compute, Step Functions for orchestration, and a React frontend for visualization. Implementation proceeds from core data models and validation through the analysis pipeline to the frontend and CLI.

## Tasks

- [x] 1. Set up project structure and core interfaces
  - [x] 1.1 Initialize monorepo with TypeScript project structure
    - Create directory structure: `packages/core`, `packages/lambdas`, `packages/frontend`, `packages/cli`, `packages/infra`
    - Initialize root `package.json` with workspaces configuration
    - Configure TypeScript (`tsconfig.json`) with strict mode, path aliases, and project references
    - Set up ESLint and Prettier configurations
    - Install core dependencies: `fast-check` for property testing, `vitest` for unit tests, `zod` for schema validation
    - _Requirements: All_

  - [x] 1.2 Define canonical data models and interfaces
    - Create `packages/core/src/models/manifest.ts` with `ResourceChangeManifest`, `ResourceChange`, `ManifestGroup`, and `ManifestMetadata` interfaces
    - Create `packages/core/src/models/dependency-graph.ts` with `DependencyGraph`, `DependencyNode`, `DependencyEdge` interfaces
    - Create `packages/core/src/models/scored-resource.ts` with `ScoredResource`, `RiskSummary`, `RiskCategory` types
    - Create `packages/core/src/models/analysis-result.ts` with `AnalysisResult`, `AnalysisStatus` interfaces
    - Create `packages/core/src/models/adapter.ts` with `AdapterRegistryEntry`, `ManifestAdapter`, `AdapterRegistryInput`, `AdapterRegistryOutput` interfaces
    - Export all models from `packages/core/src/index.ts`
    - _Requirements: 1.1, 1.3, 4.2, 4.3_

  - [x] 1.3 Write property tests for data model validation
    - **Property 1: Schema Validation Accepts All Valid Manifests**
    - **Validates: Requirements 1.1, 1.3**

- [x] 2. Implement Manifest Ingestion Service
  - [x] 2.1 Implement canonical schema validation
    - Create `packages/core/src/validation/manifest-validator.ts`
    - Define JSON Schema for `ResourceChangeManifest` using `zod`
    - Validate required fields: resource type, resource identifier, provider, modification type
    - Enforce limits: max 200 resources, max 10 MB payload, max 10 nesting levels
    - Return structured errors with JSON path of first violation
    - Implement atomic validation (reject entire manifest on any failure)
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [x] 2.2 Write property tests for schema validation
    - **Property 2: Schema Validation Rejects Invalid Manifests with Correct Error Path**
    - **Validates: Requirements 1.2, 1.6**

  - [x] 2.3 Implement hierarchy flattening
    - Create `packages/core/src/validation/hierarchy-flattener.ts`
    - Recursively flatten nested groups into a single resource list
    - Enforce max 10 levels of nesting depth
    - Return error with group path when depth limit exceeded
    - Preserve all resource entries without duplication or loss
    - _Requirements: 1.4, 1.7_

  - [x] 2.4 Write property tests for hierarchy flattening
    - **Property 3: Hierarchy Flattening Preserves All Resources**
    - **Validates: Requirements 1.4**

  - [x] 2.5 Implement Manifest Ingestion Service Lambda handler
    - Create `packages/lambdas/src/ingestion/handler.ts`
    - Orchestrate validation, flattening, and analysis ID generation
    - Return `IngestionOutput` with analysis ID, validated manifest, and resource count
    - Handle error responses with appropriate HTTP status codes (400, 413)
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Adapter System
  - [x] 4.1 Implement Adapter Registry Lambda
    - Create `packages/lambdas/src/adapter-registry/handler.ts`
    - Query DynamoDB for registered adapters by format identifier
    - Route changesets to the correct adapter Lambda ARN
    - Return error with list of supported formats for unknown format identifiers
    - _Requirements: 2.1, 2.5, 2.7_

  - [x] 4.2 Write property tests for Adapter Registry routing
    - **Property 5: Adapter Registry Routes to Correct Adapter**
    - **Validates: Requirements 2.1, 2.5**

  - [x] 4.3 Implement CloudFormation Manifest Adapter
    - Create `packages/lambdas/src/adapters/cloudformation/handler.ts`
    - Parse CloudFormation changeset format (DescribeChangeSet output)
    - Map CloudFormation resource types to canonical format
    - Map action types (Add, Modify, Remove, Import) to canonical modification types
    - Return error with parsing failure location for malformed input
    - _Requirements: 2.2, 2.6, 2.8_

  - [x] 4.4 Implement Terraform Manifest Adapter
    - Create `packages/lambdas/src/adapters/terraform/handler.ts`
    - Parse Terraform plan JSON format (`terraform show -json`)
    - Map Terraform resource types and actions to canonical format
    - Handle `create`, `update`, `delete`, `replace` action mappings
    - Return error with parsing failure location for malformed input
    - _Requirements: 2.3, 2.6, 2.8_

  - [x] 4.5 Implement CDK Manifest Adapter
    - Create `packages/lambdas/src/adapters/cdk/handler.ts`
    - Parse CDK cloud assembly diff format
    - Map CDK resource changes to canonical format
    - Handle nested construct tree flattening
    - Return error with parsing failure location for malformed input
    - _Requirements: 2.4, 2.6, 2.8_

  - [x] 4.6 Write property tests for adapter conversion
    - **Property 4: Adapter Conversion Produces Valid Canonical Manifests**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.8**

- [x] 5. Implement Resource Dependency Discovery
  - [x] 5.1 Implement Resource Resolver Lambda
    - Create `packages/lambdas/src/resource-resolver/handler.ts`
    - Query AWS Config Advanced Queries for direct resource relationships
    - Query Resource Explorer for cross-account/cross-region dependencies
    - Implement recursive graph traversal with configurable max depth (default: 5)
    - Implement circular reference detection via visited-set
    - Mark resources with partial/unknown coverage when data is incomplete
    - Scope queries to accounts/regions the requesting principal can access
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_

  - [x] 5.2 Implement in-memory LRU cache for dependency lookups
    - Create `packages/core/src/cache/lru-cache.ts`
    - Implement LRU eviction with 10,000 entry limit
    - Track cache hits/misses for reporting in output
    - Integrate cache into Resource Resolver lookup flow
    - _Requirements: 3.5_

  - [x] 5.3 Write property tests for graph traversal
    - **Property 6: Graph Traversal Terminates and Respects Depth Limit**
    - **Validates: Requirements 3.2**

  - [x] 5.4 Write property tests for dependency cache
    - **Property 7: Dependency Cache Prevents Redundant Lookups**
    - **Validates: Requirements 3.5**

  - [x] 5.5 Implement retry logic with exponential backoff for AWS service calls
    - Create `packages/core/src/utils/retry.ts`
    - Implement retry up to 3 times with exponential backoff (1s, 2s, 4s)
    - Classify retryable vs non-retryable errors
    - On persistent failure, mark resources as unknown coverage and continue
    - _Requirements: 3.7_

- [x] 6. Implement Impact Analysis and Risk Scoring
  - [x] 6.1 Implement Risk Assessor Lambda
    - Create `packages/lambdas/src/risk-assessor/handler.ts`
    - Implement Impact_Score formula: `(depthScore * 0.30) + (criticalityScore * 0.40) + (changeTypeSeverity * 0.30)`
    - Implement depth score: `max(10, 100 - ((depth - 1) * 10))`
    - Map criticality classifications: Critical=100, High=75, Medium=50, Low=25
    - Map change type severity: Remove=100, Replace=80, Modify=50
    - Cap depth contribution at depth 10
    - _Requirements: 4.1, 4.2, 4.5, 4.7_

  - [x] 6.2 Write property tests for Impact Score formula
    - **Property 8: Impact Score Formula Correctness**
    - **Validates: Requirements 4.2, 4.5**

  - [x] 6.3 Implement risk category classification
    - Classify scores: Critical (75-100), High (50-74), Medium (25-49), Low (0-24)
    - Include dependency chain for Critical resources (ordered list of resource IDs)
    - Handle multi-path scoring by selecting highest-scoring path
    - _Requirements: 4.3, 4.4, 4.6_

  - [x] 6.4 Write property tests for score-to-category classification
    - **Property 9: Score-to-Category Classification**
    - **Validates: Requirements 4.3**

  - [x] 6.5 Write property tests for multi-path scoring
    - **Property 10: Multi-Path Scoring Uses Maximum**
    - **Validates: Requirements 4.6**

  - [x] 6.6 Write property tests for critical resource dependency chains
    - **Property 11: Critical Resources Include Dependency Chain**
    - **Validates: Requirements 4.4**

  - [x] 6.7 Implement resource criticality configuration
    - Create `packages/core/src/config/criticality-map.ts`
    - Define default criticality mappings per resource type (Critical, High, Medium, Low)
    - Support loading custom criticality overrides from configuration
    - _Requirements: 4.2_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement Analysis Orchestration
  - [x] 8.1 Implement Step Functions state machine definition
    - Create `packages/infra/src/constructs/analysis-pipeline.ts`
    - Define states: Ingestion → AdapterConversion (conditional) → Discovery → Scoring → VisualizationPrep → SummaryGeneration (conditional) → Complete
    - Configure retry policies: 3 retries, exponential backoff 2s→4s→8s, capped at 30s
    - Configure non-retryable error handling (immediate failure)
    - _Requirements: 5.1, 5.2, 5.7_

  - [x] 8.2 Implement analysis status tracking
    - Create `packages/lambdas/src/status/handler.ts`
    - Store/update status in DynamoDB: analysis ID, current stage, progress percentage, elapsed time
    - Expose GET endpoint returning status within 2 seconds
    - Tag results with requesting principal's IAM ARN and originating account ID
    - _Requirements: 5.5, 5.6, 9.6_

  - [x] 8.3 Implement partial results storage on failure
    - Create `packages/lambdas/src/pipeline/failure-handler.ts`
    - Store partial results in S3 on pipeline failure
    - Record completed stages and failed stage with error category
    - Set analysis status to "failed" with error details
    - _Requirements: 5.3, 5.7_

  - [x] 8.4 Implement Visualization Prep Lambda
    - Create `packages/lambdas/src/visualization-prep/handler.ts`
    - Transform scored dependency graph into node/edge lists with layout hints
    - Store visualization-ready results in S3
    - _Requirements: 5.6, 6.1_

- [x] 9. Implement Visualization Frontend
  - [x] 9.1 Initialize React frontend application
    - Create `packages/frontend` with React, TypeScript, and Vite
    - Install graph visualization library (Cytoscape.js or D3.js)
    - Set up routing for analysis views
    - Configure API client for backend communication
    - _Requirements: 6.1_

  - [x] 9.2 Implement interactive dependency graph component
    - Create graph visualization component with zoom, pan, and node selection
    - Color-code nodes by risk category: Critical (red), High (orange), Medium (yellow), Low (green)
    - Display resource details on node selection: resource type, ID, Impact_Score, dependency chain
    - Render within 5 seconds for graphs up to 500 nodes
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 9.3 Implement graph filtering
    - Create filter controls for risk category, resource type, and source IaC tool
    - Update displayed graph within 2 seconds of filter application
    - Maintain filter state across interactions
    - _Requirements: 6.4_

  - [x] 9.4 Write property tests for graph filtering
    - **Property 12: Graph Filtering Returns Only Matching Resources**
    - **Validates: Requirements 6.4**

  - [x] 9.5 Implement tabular summary view
    - Create sortable table listing all affected resources
    - Sort by Impact_Score in descending order
    - Paginate in groups of 50 resources per page
    - _Requirements: 6.5_

  - [x] 9.6 Write property tests for tabular sorting
    - **Property 13: Tabular View Sorted by Impact Score Descending**
    - **Validates: Requirements 6.5**

  - [x] 9.7 Implement export functionality
    - Create JSON export with all required fields (resource type, ID, Impact_Score, risk category, dependency chain)
    - Create PDF export with dependency graph, scores, categories, chains, and applied filters
    - Generate exports within 30 seconds
    - _Requirements: 6.6, 6.8_

  - [x] 9.8 Write property tests for JSON export
    - **Property 14: JSON Export Contains All Required Fields**
    - **Validates: Requirements 6.6, 6.8**

  - [x] 9.9 Implement status polling and error handling
    - Poll analysis status endpoint during execution
    - Display progress percentage and current stage
    - Show user-friendly error messages with retry option
    - Fall back to tabular view if graph rendering fails
    - _Requirements: 5.5, 6.7_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement CI/CD Integration and CLI
  - [x] 11.1 Implement REST API endpoints
    - Create `packages/infra/src/constructs/api-gateway.ts` with API Gateway REST API
    - Implement POST `/analyze` endpoint accepting manifest or native changeset
    - Implement GET `/analyze/{analysisId}` for status and results
    - Implement GET `/analyze/{analysisId}/export` for JSON/PDF export
    - Implement GET `/formats` listing supported adapter formats
    - Configure SigV4 authentication on all endpoints
    - Set 180-second timeout with partial results on timeout
    - _Requirements: 7.1, 7.8, 9.1_

  - [x] 11.2 Implement pass/fail verdict logic
    - Create `packages/core/src/verdict/threshold-evaluator.ts`
    - Accept risk threshold parameter (integer, 0-100)
    - Return "fail" verdict with non-zero exit code if any resource exceeds threshold
    - Return "pass" verdict with exit code 0 and summary (total affected, highest score)
    - Validate threshold parameter and return error for invalid values
    - _Requirements: 7.2, 7.5, 7.6, 7.7_

  - [x] 11.3 Write property tests for verdict logic
    - **Property 15: Verdict Correctness**
    - **Validates: Requirements 7.2, 7.5, 7.6**

  - [x] 11.4 Write property tests for threshold validation
    - **Property 16: Invalid Threshold Rejection**
    - **Validates: Requirements 7.7**

  - [x] 11.5 Implement CLI tool
    - Create `packages/cli/src/index.ts` as CLI entry point
    - Implement `blast-radius analyze` command with `--format`, `--input`, `--threshold`, `--ci` flags
    - Implement `blast-radius status` command with `--analysis-id` flag
    - Implement `blast-radius export` command with `--analysis-id` and `--format` flags
    - Accept input from stdin or file path
    - Output machine-readable JSON in CI mode
    - Set exit codes: 0 (pass), 1 (fail/threshold exceeded), 2 (error)
    - _Requirements: 7.3, 7.4, 7.5, 7.6_

- [x] 12. Implement Natural Language Risk Summary
  - [x] 12.1 Implement Risk Summary Generator Lambda
    - Create `packages/lambdas/src/risk-summary/handler.ts`
    - Invoke Amazon Bedrock InvokeModel API with structured prompt
    - Select top 3 highest-scoring resources (or all if fewer than 3) for summary input
    - Generate summary not exceeding 500 words
    - Set 15-second timeout; on failure, return gracefully without blocking results
    - Implement feature flag to enable/disable Bedrock integration
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 12.2 Write property tests for top-K risk selection
    - **Property 17: Top-K Risk Selection for Summary**
    - **Validates: Requirements 8.2**

- [x] 13. Implement Access Control and Multi-Tenancy
  - [x] 13.1 Implement IAM-based access scoping
    - Create `packages/core/src/auth/access-scoper.ts`
    - Extract requesting principal's IAM ARN from SigV4 signature
    - Scope resource discovery to authorized accounts/regions
    - Omit unauthorized accounts from results with exclusion summary
    - Ensure no resource details from unauthorized accounts are exposed
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 13.2 Write property tests for access scoping
    - **Property 18: Access Scoping Excludes Unauthorized Resources**
    - **Validates: Requirements 9.3, 9.4, 9.5**

  - [x] 13.3 Implement result retrieval authorization
    - Create `packages/lambdas/src/results/handler.ts`
    - Return only results tagged with the requesting principal's identity
    - Allow access to results for accounts the principal is currently authorized to access
    - _Requirements: 9.7_

  - [x] 13.4 Write property tests for result retrieval authorization
    - **Property 19: Result Retrieval Respects Authorization**
    - **Validates: Requirements 9.7**

- [x] 14. Implement Infrastructure (CDK)
  - [x] 14.1 Define CDK infrastructure stack
    - Create `packages/infra/src/stacks/blast-radius-stack.ts`
    - Define Lambda functions for all handlers with appropriate memory/timeout settings
    - Define DynamoDB tables (adapter registry, analysis status)
    - Define S3 bucket for results storage with lifecycle policies
    - Define API Gateway REST API with SigV4 authorizer
    - Define Step Functions state machine
    - Define CloudFront distribution with S3 origin for frontend
    - Configure IAM roles with least-privilege permissions
    - _Requirements: All_

  - [x] 14.2 Wire all components together
    - Connect API Gateway routes to Lambda handlers
    - Connect Step Functions state machine to Lambda functions
    - Grant Lambda functions access to DynamoDB, S3, AWS Config, Resource Explorer
    - Configure environment variables for Lambda functions
    - Set up CloudWatch log groups and alarms
    - _Requirements: All_

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript throughout, matching the design document's interface definitions
- `fast-check` is used for property-based testing as specified in the design's testing strategy
- `vitest` is used as the test runner for both unit and property tests

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4", "2.5"] },
    { "id": 5, "tasks": ["4.1", "5.2", "6.7"] },
    { "id": 6, "tasks": ["4.2", "4.3", "4.4", "4.5", "5.1", "5.5", "6.1"] },
    { "id": 7, "tasks": ["4.6", "5.3", "5.4", "6.2", "6.3"] },
    { "id": 8, "tasks": ["6.4", "6.5", "6.6", "8.1", "8.2"] },
    { "id": 9, "tasks": ["8.3", "8.4", "11.2"] },
    { "id": 10, "tasks": ["9.1", "11.1", "11.3", "11.4"] },
    { "id": 11, "tasks": ["9.2", "9.3", "9.5", "11.5", "12.1", "13.1"] },
    { "id": 12, "tasks": ["9.4", "9.6", "9.7", "9.9", "12.2", "13.2", "13.3"] },
    { "id": 13, "tasks": ["9.8", "13.4", "14.1"] },
    { "id": 14, "tasks": ["14.2"] }
  ]
}
```
