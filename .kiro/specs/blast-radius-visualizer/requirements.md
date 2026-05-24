# Requirements Document

## Introduction

The Blast Radius Pre-Deploy Visualizer is a tool that analyzes infrastructure-as-code changesets before deployment to identify and visualize downstream dependencies that may be affected by proposed changes. It shifts the discovery of unintended impact from post-deploy incidents to pre-deploy review, reducing rollbacks, outages, and cross-team surprises.

The system is IaC-tool-agnostic. It defines a canonical Resource Change Manifest format that describes proposed infrastructure modifications in a tool-neutral way. Adapters convert native changeset formats (CloudFormation, CDK, Terraform, Pulumi, and others) into the canonical format. The core analysis engine — dependency discovery, risk scoring, orchestration, and visualization — operates exclusively on the canonical format, enabling support for any IaC tool without modifying the core system.

The system queries AWS Config and Resource Explorer for resource relationships, performs impact analysis via Step Functions-orchestrated Lambda functions, and presents an interactive dependency graph with risk scoring. Optionally, it generates natural language risk summaries using Amazon Bedrock.

## Glossary

- **Visualizer**: The complete Blast Radius Pre-Deploy Visualizer system
- **Resource_Change_Manifest**: A canonical, tool-neutral JSON document describing proposed infrastructure modifications, including resource types, identifiers, and modification types
- **Manifest_Adapter**: A plugin component that converts a native IaC tool changeset (CloudFormation, CDK, Terraform, Pulumi, etc.) into a Resource_Change_Manifest
- **Adapter_Registry**: The component that manages available Manifest_Adapters and routes incoming changesets to the appropriate adapter based on declared format
- **Blast_Radius**: The set of resources that are directly or transitively dependent on resources being modified in a Resource_Change_Manifest
- **Dependency_Graph**: A directed graph representing relationships between cloud resources where edges indicate dependency direction
- **Impact_Score**: A numeric risk rating (0-100) assigned to each affected resource based on dependency depth, resource criticality, and change type
- **Analysis_Pipeline**: The Step Functions state machine that orchestrates the end-to-end impact analysis workflow
- **Resource_Resolver**: The Lambda function responsible for discovering resource relationships via AWS Config and Resource Explorer
- **Risk_Assessor**: The Lambda function that computes impact scores and categorizes risk levels
- **Manifest_Ingestion_Service**: The component that validates and accepts Resource_Change_Manifests, either submitted directly or produced by a Manifest_Adapter
- **Visualization_Frontend**: The S3 and CloudFront-hosted web application that renders the interactive dependency graph
- **Risk_Summary_Generator**: The optional Bedrock-powered component that produces natural language explanations of blast radius impact

## Requirements

### Requirement 1: Resource Change Manifest Ingestion

**User Story:** As a DevOps engineer, I want to submit a canonical resource change manifest for analysis, so that I can understand the impact of my proposed changes regardless of which IaC tool I use.

#### Acceptance Criteria

1. WHEN a valid Resource_Change_Manifest is submitted containing up to 200 resource modifications, THE Manifest_Ingestion_Service SHALL validate the manifest against the canonical schema and accept it for analysis within 3 seconds
2. IF an invalid or malformed Resource_Change_Manifest is submitted, THEN THE Manifest_Ingestion_Service SHALL return an error message indicating the JSON path of the schema violation within 3 seconds
3. THE Manifest_Ingestion_Service SHALL require each resource entry in the manifest to include: resource type, resource identifier, provider (e.g., aws, azure, gcp), and modification type (Add, Modify, Remove, Replace)
4. WHEN a Resource_Change_Manifest contains hierarchical or grouped changes (e.g., module-level or stack-level groupings), THE Manifest_Ingestion_Service SHALL flatten the hierarchy into a single list of resource modifications up to a maximum nesting depth of 10 levels
5. IF a Resource_Change_Manifest exceeds 200 resource modifications or 10 MB in size, THEN THE Manifest_Ingestion_Service SHALL reject the submission with an error message indicating the exceeded limit
6. IF validation succeeds for some resources but fails for others within a single manifest, THEN THE Manifest_Ingestion_Service SHALL reject the entire manifest and return an error message indicating the first resource entry that failed validation
7. IF hierarchical flattening exceeds 10 levels of nesting depth, THEN THE Manifest_Ingestion_Service SHALL halt recursion and return an error message indicating the group path where the depth limit was reached

### Requirement 2: Manifest Adapter System

**User Story:** As a DevOps engineer, I want to submit changesets in my IaC tool's native format and have them automatically converted to the canonical manifest, so that I do not need to manually transform my changesets.

#### Acceptance Criteria

1. THE Adapter_Registry SHALL accept incoming changesets with a declared source format identifier (e.g., "cloudformation", "cdk", "terraform-plan", "pulumi") and route them to the corresponding Manifest_Adapter
2. WHEN a CloudFormation changeset is submitted, THE Manifest_Adapter for CloudFormation SHALL convert it into a valid Resource_Change_Manifest within 5 seconds for changesets containing up to 200 resource modifications
3. WHEN a Terraform plan JSON is submitted, THE Manifest_Adapter for Terraform SHALL convert it into a valid Resource_Change_Manifest within 5 seconds for plans containing up to 200 resource modifications
4. WHEN a CDK cloud assembly diff is submitted, THE Manifest_Adapter for CDK SHALL convert it into a valid Resource_Change_Manifest within 5 seconds for diffs containing up to 200 resource modifications
5. IF a submitted changeset declares an unsupported source format, THEN THE Adapter_Registry SHALL return an error message listing the supported format identifiers
6. IF a Manifest_Adapter fails to convert a changeset due to malformed input, THEN THE Manifest_Adapter SHALL return an error message indicating the location of the parsing failure in the native format
7. THE Adapter_Registry SHALL support registration of new Manifest_Adapters without modification to the core analysis engine or existing adapters
8. WHEN a Manifest_Adapter produces a Resource_Change_Manifest, THE Manifest_Ingestion_Service SHALL validate the output against the canonical schema before accepting it for analysis

### Requirement 3: Resource Dependency Discovery

**User Story:** As a DevOps engineer, I want the system to automatically discover all resources that depend on my changed resources, so that I can see the full downstream impact without manual investigation.

#### Acceptance Criteria

1. WHEN a validated Resource_Change_Manifest is provided, THE Resource_Resolver SHALL query AWS Config relationship data to identify all directly dependent resources within 30 seconds per resource in the manifest
2. WHEN direct dependencies are identified, THE Resource_Resolver SHALL recursively traverse the dependency graph up to a configurable maximum depth (default: 5 levels), detecting and skipping circular references to prevent infinite traversal
3. WHEN dependency discovery is initiated, THE Resource_Resolver SHALL query Resource Explorer to discover cross-account and cross-region resource relationships for each resource in the traversal
4. IF AWS Config returns no relationship data or returns fewer than the expected relationship types for a given resource type, THEN THE Resource_Resolver SHALL log a warning and mark the resource as having partial dependency coverage in the dependency graph output
5. WHILE the Analysis_Pipeline is executing, THE Resource_Resolver SHALL cache discovered relationships (up to 10,000 entries) to avoid redundant API calls within the same analysis run
6. WHEN traversing dependencies, THE Resource_Resolver SHALL resolve security group references, IAM policy attachments, VPC associations, and subnet dependencies by including them in the dependency graph with the same traversal depth and scoring treatment as any other dependency type
7. IF AWS Config or Resource Explorer is unavailable or returns a service error, THEN THE Resource_Resolver SHALL retry the request up to 3 times with exponential backoff, and if still unsuccessful, mark affected resources as having unknown dependency coverage and continue processing remaining resources

### Requirement 4: Impact Analysis and Risk Scoring

**User Story:** As a platform engineer, I want each affected resource scored by risk level, so that I can prioritize review of the most dangerous downstream effects.

#### Acceptance Criteria

1. WHEN the dependency graph is fully resolved, THE Risk_Assessor SHALL assign an Impact_Score (integer, 0-100) to each affected resource within 5 seconds of graph resolution completing
2. THE Risk_Assessor SHALL compute Impact_Score based on: dependency depth normalized to a 0-100 scale where depth 1 equals 100 and the maximum supported depth of 10 equals 10 (weight: 30%), resource criticality classification mapped to a numeric value where Critical equals 100, High equals 75, Medium equals 50, and Low equals 25 (weight: 40%), and change type severity (weight: 30%)
3. THE Risk_Assessor SHALL classify resources into risk categories: Critical (score 75-100), High (score 50-74), Medium (score 25-49), Low (score 0-24)
4. WHEN a resource is classified as Critical, THE Risk_Assessor SHALL include the specific dependency chain from the changed resource to the affected resource as an ordered list of resource identifiers
5. THE Risk_Assessor SHALL assign change type severity values as: Remove equals 100, Replace equals 80, and Modify equals 50
6. IF a resource has multiple dependency paths to a changed resource, THEN THE Risk_Assessor SHALL use the highest-risk path for scoring
7. IF the dependency depth of a path exceeds 10 levels, THEN THE Risk_Assessor SHALL cap the depth contribution at the value corresponding to depth 10

### Requirement 5: Analysis Orchestration

**User Story:** As a DevOps engineer, I want the analysis to run as a reliable, observable workflow, so that I can trust the results and debug failures.

#### Acceptance Criteria

1. THE Analysis_Pipeline SHALL orchestrate the analysis as a Step Functions state machine with stages: Ingestion, Adapter Conversion (if applicable), Discovery, Scoring, Visualization Preparation
2. WHEN any stage fails with a retryable error, THE Analysis_Pipeline SHALL retry the failed stage up to 3 times with exponential backoff starting at 2 seconds and capped at 30 seconds before marking the analysis as failed
3. IF the Analysis_Pipeline fails after retries, THEN THE Analysis_Pipeline SHALL store partial results in S3 under the same analysis ID, record which stages completed successfully and which stage failed, and set the analysis status to "failed" on the status endpoint
4. THE Analysis_Pipeline SHALL complete end-to-end analysis within 120 seconds for manifests affecting up to 50 resources
5. WHILE the Analysis_Pipeline is executing, THE Visualizer SHALL expose a status endpoint reporting current stage name, progress percentage (0-100), and elapsed time, with responses returned within 2 seconds
6. WHEN analysis completes successfully, THE Analysis_Pipeline SHALL store the full result in S3 with a unique analysis ID, including the dependency graph, impact scores, analysis timestamp, requesting principal, source format identifier, and stage durations
7. IF a stage encounters a non-retryable error (invalid input, permission denied, or resource not found), THEN THE Analysis_Pipeline SHALL immediately mark the analysis as failed without retrying and record the error category on the status endpoint

### Requirement 6: Visualization and Reporting

**User Story:** As a DevOps engineer, I want to see an interactive graph of my blast radius, so that I can visually trace which resources are at risk and why.

#### Acceptance Criteria

1. WHEN analysis results are available, THE Visualization_Frontend SHALL render the Dependency_Graph within 5 seconds for graphs containing up to 500 nodes, with nodes representing resources and edges representing dependency relationships, supporting zoom, pan, and node selection interactions
2. THE Visualization_Frontend SHALL color-code nodes by risk category: Critical (red), High (orange), Medium (yellow), Low (green)
3. WHEN a user selects a node, THE Visualization_Frontend SHALL display resource details within 1 second, including: resource type, resource identifier, Impact_Score, and the full dependency chain from the changed resource to the selected resource
4. THE Visualization_Frontend SHALL allow users to filter the graph by risk category, resource type, and source IaC tool, and SHALL update the displayed graph within 2 seconds of filter application
5. THE Visualization_Frontend SHALL provide a tabular summary view listing all affected resources sorted by Impact_Score in descending order, paginated in groups of 50 resources per page
6. WHEN a user requests an export, THE Visualization_Frontend SHALL generate a PDF or JSON report within 30 seconds containing the dependency graph structure, all resource Impact_Scores, risk categories, dependency chains, and applied filters at time of export
7. IF the Visualization_Frontend fails to render the Dependency_Graph or generate an export, THEN THE Visualization_Frontend SHALL display an error message indicating the failure reason and provide the option to retry the operation
8. WHEN a user requests a JSON export, THE Visualization_Frontend SHALL include all affected resources with their resource type, resource identifier, Impact_Score, risk category, and dependency chain

### Requirement 7: CI/CD Integration

**User Story:** As a DevOps engineer, I want to integrate blast radius analysis into my CI/CD pipeline, so that risky deployments are flagged automatically before reaching production.

#### Acceptance Criteria

1. THE Visualizer SHALL expose a REST API that accepts either a Resource_Change_Manifest or a native changeset with a declared source format, and returns analysis results in JSON format within 180 seconds
2. WHEN the API is invoked with a risk threshold parameter (integer, 0-100), THE Visualizer SHALL return a pass/fail verdict based on whether any resource exceeds the specified Impact_Score threshold
3. THE Visualizer SHALL provide a CLI tool that wraps the API for use in pipeline scripts, accepting input from stdin or a file path
4. WHEN invoked in CI mode, THE Visualizer SHALL output results in a machine-readable JSON format suitable for integration with any CI/CD system (e.g., GitHub Actions, GitLab CI, Jenkins, CodePipeline)
5. IF the analysis verdict is "fail", THEN THE Visualizer SHALL return a non-zero exit code and include the list of resources exceeding the threshold with their Impact_Scores and dependency chains
6. IF the analysis verdict is "pass", THEN THE Visualizer SHALL return exit code 0 and include a summary of the total number of affected resources and the highest Impact_Score found
7. IF the risk threshold parameter is missing or outside the valid range (0-100), THEN THE Visualizer SHALL return an error response indicating the valid parameter range
8. IF the analysis fails to complete within 180 seconds, THEN THE Visualizer SHALL return a timeout error with the partial results available at that point

### Requirement 8: Natural Language Risk Summary (Optional)

**User Story:** As a team lead reviewing deployments, I want a plain-English summary of the blast radius, so that I can quickly understand the risk without reading raw dependency data.

#### Acceptance Criteria

1. WHERE the Bedrock integration is enabled, THE Risk_Summary_Generator SHALL produce a natural language summary of the blast radius analysis not exceeding 500 words
2. WHERE the Bedrock integration is enabled, WHEN analysis completes, THE Risk_Summary_Generator SHALL describe up to the top 3 highest-risk impacts in plain language including affected service, risk reason, and suggested mitigation; IF fewer than 3 resources are affected, THE Risk_Summary_Generator SHALL describe all affected resources
3. WHERE the Bedrock integration is enabled, THE Risk_Summary_Generator SHALL generate the summary within 15 seconds of analysis completion
4. WHERE the Bedrock integration is enabled, IF the summary generation fails or times out, THEN THE Visualizer SHALL still present the structured analysis results without the natural language summary and include a notice indicating the summary is unavailable
5. WHERE the Bedrock integration is disabled, THE Visualizer SHALL not invoke the Risk_Summary_Generator and SHALL not display a summary section in the results

### Requirement 9: Access Control and Multi-Tenancy

**User Story:** As a platform engineer, I want the visualizer to respect AWS account boundaries and IAM permissions, so that teams only see blast radius data for resources they are authorized to access.

#### Acceptance Criteria

1. THE Visualizer SHALL authenticate API requests using IAM-based authentication (SigV4)
2. IF an API request fails SigV4 authentication, THEN THE Visualizer SHALL reject the request and return an error indicating invalid or missing credentials without revealing internal system details
3. WHEN a user requests analysis, THE Visualizer SHALL scope resource discovery to accounts and regions where the requesting principal's IAM policies grant the required read actions
4. IF a requesting principal lacks read permissions for one or more accounts included in the analysis scope, THEN THE Visualizer SHALL omit those accounts from the results and include a summary indicating which accounts were excluded due to insufficient permissions
5. THE Visualizer SHALL not expose resource details from accounts where the requesting principal lacks read permissions
6. WHEN analysis results are stored, THE Analysis_Pipeline SHALL tag results with the requesting principal's IAM ARN and the originating AWS account ID
7. WHEN a principal requests previously stored analysis results, THE Visualizer SHALL return only results tagged with that principal's identity or results for accounts the principal is currently authorized to access
