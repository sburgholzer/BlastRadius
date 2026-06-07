import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/**
 * Properties for the AnalysisPipeline construct.
 */
export interface AnalysisPipelineProps {
  /** Lambda function that validates and ingests manifests */
  ingestionFunction: lambda.IFunction;
  /** Lambda function that routes to the appropriate adapter for format conversion */
  adapterRegistryFunction: lambda.IFunction;
  /** Lambda function that discovers resource dependencies */
  resourceResolverFunction: lambda.IFunction;
  /** Lambda function that computes impact scores */
  riskAssessorFunction: lambda.IFunction;
  /** Lambda function that prepares visualization data */
  visualizationPrepFunction: lambda.IFunction;
  /** Lambda function that generates natural language risk summaries via Bedrock */
  riskSummaryFunction: lambda.IFunction;
  /** Lambda function that updates analysis status */
  statusFunction: lambda.IFunction;
}

/**
 * Non-retryable error types that should cause immediate failure.
 */
const NON_RETRYABLE_ERRORS = [
  'ValidationError',
  'PermissionDenied',
  'ResourceNotFound',
];

/**
 * AnalysisPipeline construct defines the Step Functions state machine
 * that orchestrates the blast radius analysis workflow.
 *
 * States: Ingestion → AdapterConversion (conditional) → Discovery → Scoring →
 *         VisualizationPrep → SummaryGeneration (conditional) → Complete
 *
 * Validates: Requirements 5.1, 5.2, 5.7
 */
export class AnalysisPipeline extends Construct {
  /** The Step Functions state machine */
  public readonly stateMachine: sfn.StateMachine;

  /** Shared error handling state that updates status to failed */
  private readonly failState: sfn.IChainable;

  constructor(scope: Construct, id: string, props: AnalysisPipelineProps) {
    super(scope, id);

    // --- Error handling: update status to "failed" then terminate ---
    const updateStatusFailed = new tasks.LambdaInvoke(this, 'UpdateStatusFailed', {
      lambdaFunction: props.statusFunction,
      payload: sfn.TaskInput.fromObject({
        'operation': 'update',
        'analysisId.$': '$.analysisId',
        'status': 'failed',
        'currentStage': 'Error',
        'progressPercentage': 0,
      }),
      resultPath: sfn.JsonPath.DISCARD,
      comment: 'Update analysis status to failed',
    });

    const terminalFail = new sfn.Fail(this, 'PipelineFailed', {
      cause: 'Pipeline execution failed',
      error: 'PipelineError',
    });

    updateStatusFailed.next(terminalFail);
    updateStatusFailed.addCatch(terminalFail, {
      errors: ['States.ALL'],
      resultPath: sfn.JsonPath.DISCARD,
    });

    this.failState = updateStatusFailed;

    // --- Define states ---

    // 1. AdapterConversion - Convert native changeset to canonical manifest
    //    Input: { format: sourceFormat, payload: manifest }
    //    Output stored at $.adapterResult, preserving the rest of the state.
    const adapterConversion = new tasks.LambdaInvoke(this, 'AdapterConversion', {
      lambdaFunction: props.adapterRegistryFunction,
      payload: sfn.TaskInput.fromObject({
        'format.$': '$.sourceFormat',
        'payload.$': '$.manifest',
      }),
      resultPath: '$.adapterResult',
      resultSelector: {
        'manifest.$': '$.Payload.manifest',
        'adapterMetadata.$': '$.Payload.adapterMetadata',
      },
      comment: 'Convert native changeset format to canonical manifest',
    });
    this.addRetryPolicy(adapterConversion);
    this.addNonRetryableCatch(adapterConversion);

    // 2. PrepareAfterAdapter - Pass state that reshapes adapter output back into
    //    the shape ingestion expects: { manifest: <canonical>, sourceFormat, ... }
    const prepareAfterAdapter = new sfn.Pass(this, 'PrepareAfterAdapter', {
      comment: 'Reshape adapter output for ingestion',
      parameters: {
        'analysisId.$': '$.analysisId',
        'sourceFormat': 'canonical',
        'manifest.$': '$.adapterResult.manifest',
        'options.$': '$.options',
        'requestingPrincipal.$': '$.requestingPrincipal',
        'originatingAccountId.$': '$.originatingAccountId',
      },
    });

    // 3. Ingestion - Validate and ingest the canonical manifest
    const ingestion = new tasks.LambdaInvoke(this, 'Ingestion', {
      lambdaFunction: props.ingestionFunction,
      outputPath: '$.Payload',
      comment: 'Validate and ingest the resource change manifest',
    });
    this.addRetryPolicy(ingestion);
    this.addNonRetryableCatch(ingestion);

    // 4. Discovery - Invoke resource resolver
    const discovery = new tasks.LambdaInvoke(this, 'Discovery', {
      lambdaFunction: props.resourceResolverFunction,
      resultPath: '$.discoveryResult',
      resultSelector: {
        'dependencyGraph.$': '$.Payload.dependencyGraph',
        'coverage.$': '$.Payload.coverage',
        'cacheStats.$': '$.Payload.cacheStats',
      },
      comment: 'Discover resource dependencies via AWS Config and Resource Explorer',
    });
    this.addRetryPolicy(discovery);
    this.addNonRetryableCatch(discovery);

    // 5. Scoring - Invoke risk assessor
    const scoring = new tasks.LambdaInvoke(this, 'Scoring', {
      lambdaFunction: props.riskAssessorFunction,
      payload: sfn.TaskInput.fromObject({
        'dependencyGraph.$': '$.discoveryResult.dependencyGraph',
        'manifest.$': '$.validatedManifest',
      }),
      resultPath: '$.scoringResult',
      resultSelector: {
        'scoredResources.$': '$.Payload.scoredResources',
        'riskSummary.$': '$.Payload.riskSummary',
      },
      comment: 'Compute impact scores and classify risk levels',
    });
    this.addRetryPolicy(scoring);
    this.addNonRetryableCatch(scoring);

    // 6. VisualizationPrep - Invoke visualization prep
    const visualizationPrep = new tasks.LambdaInvoke(this, 'VisualizationPrep', {
      lambdaFunction: props.visualizationPrepFunction,
      payload: sfn.TaskInput.fromObject({
        'analysisId.$': '$.analysisId',
        'dependencyGraph.$': '$.discoveryResult.dependencyGraph',
        'scoredResources.$': '$.scoringResult.scoredResources',
        'riskSummary.$': '$.scoringResult.riskSummary',
        'manifest.$': '$.validatedManifest',
      }),
      resultPath: '$.visualizationResult',
      comment: 'Prepare visualization data for frontend rendering',
    });
    this.addRetryPolicy(visualizationPrep);
    this.addNonRetryableCatch(visualizationPrep);

    // 7. SummaryGeneration - Conditional: if enableSummary === true, invoke risk summary generator
    const summaryGeneration = new tasks.LambdaInvoke(this, 'SummaryGeneration', {
      lambdaFunction: props.riskSummaryFunction,
      payload: sfn.TaskInput.fromObject({
        'analysisId.$': '$.analysisId',
        'scoredResources.$': '$.scoringResult.scoredResources',
        'riskSummary.$': '$.scoringResult.riskSummary',
        'manifest.$': '$.validatedManifest',
      }),
      resultPath: '$.summaryResult',
      comment: 'Generate natural language risk summary via Amazon Bedrock',
    });
    this.addRetryPolicy(summaryGeneration);
    this.addNonRetryableCatch(summaryGeneration);

    // 8. Complete - Success state
    const complete = new sfn.Succeed(this, 'Complete', {
      comment: 'Analysis pipeline completed successfully',
    });

    // --- Define conditional logic ---

    // Choice: should we run adapter conversion?
    // Runs BEFORE ingestion so $.sourceFormat is still available from the original input.
    const needsAdapterConversion = new sfn.Choice(this, 'NeedsAdapterConversion')
      .when(
        sfn.Condition.not(
          sfn.Condition.stringEquals('$.sourceFormat', 'canonical')
        ),
        adapterConversion
      )
      .otherwise(ingestion);

    // --- Chain the states ---
    // (AdapterConversion?) → Ingestion → Discovery → Scoring → VisualizationPrep → (SummaryGeneration?) → Complete
    //
    // Non-canonical path: NeedsAdapterConversion → AdapterConversion → PrepareAfterAdapter → Ingestion → ...
    // Canonical path:     NeedsAdapterConversion → Ingestion → ...
    adapterConversion.next(prepareAfterAdapter);
    prepareAfterAdapter.next(ingestion);

    // Add progress updates between stages
    const updateAfterIngestion = this.createProgressUpdate(props.statusFunction, 'AfterIngestion', 'Discovery', 20);
    const updateAfterDiscovery = this.createProgressUpdate(props.statusFunction, 'AfterDiscovery', 'Scoring', 40);
    const updateAfterScoring = this.createProgressUpdate(props.statusFunction, 'AfterScoring', 'VisualizationPrep', 60);
    const updateAfterVisualization = this.createProgressUpdate(props.statusFunction, 'AfterVisualization', 'SummaryGeneration', 80);
    const updateComplete = this.createProgressUpdate(props.statusFunction, 'MarkComplete', 'Complete', 100, 'completed');

    // The complete update needs the resultLocation from visualization prep
    // Override it with a custom task that includes the S3 key
    const markComplete = new tasks.LambdaInvoke(this, 'MarkAnalysisComplete', {
      lambdaFunction: props.statusFunction,
      payload: sfn.TaskInput.fromObject({
        'operation': 'update',
        'analysisId.$': '$.analysisId',
        'status': 'completed',
        'currentStage': 'Complete',
        'progressPercentage': 100,
        'resultLocation.$': '$.visualizationResult.Payload.s3Key',
      }),
      resultPath: sfn.JsonPath.DISCARD,
      comment: 'Mark analysis as completed with result location',
    });
    markComplete.addRetry({
      errors: ['States.ALL'],
      maxAttempts: 2,
      interval: cdk.Duration.seconds(1),
    });

    // Choice: should we generate a summary?
    // Uses Condition.and to check the field exists AND is true — avoids crash on missing path.
    const needsSummaryGeneration = new sfn.Choice(this, 'NeedsSummaryGeneration')
      .when(
        sfn.Condition.and(
          sfn.Condition.isPresent('$.options.enableSummary'),
          sfn.Condition.booleanEquals('$.options.enableSummary', true),
        ),
        summaryGeneration,
      )
      .otherwise(markComplete);

    ingestion.next(updateAfterIngestion);
    updateAfterIngestion.next(discovery);
    discovery.next(updateAfterDiscovery);
    updateAfterDiscovery.next(scoring);
    scoring.next(updateAfterScoring);
    updateAfterScoring.next(visualizationPrep);
    visualizationPrep.next(updateAfterVisualization);
    updateAfterVisualization.next(needsSummaryGeneration);
    summaryGeneration.next(markComplete);
    markComplete.next(complete);

    // --- Create the state machine ---
    this.stateMachine = new sfn.StateMachine(this, 'AnalysisPipelineStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(needsAdapterConversion),
      timeout: cdk.Duration.seconds(120),
      comment: 'Blast Radius Analysis Pipeline - orchestrates end-to-end impact analysis',
    });
  }

  /**
   * Creates a progress update task that invokes the status function.
   */
  private createProgressUpdate(
    statusFunction: lambda.IFunction,
    id: string,
    stage: string,
    percentage: number,
    status: string = 'running',
  ): tasks.LambdaInvoke {
    const task = new tasks.LambdaInvoke(this, `UpdateProgress-${id}`, {
      lambdaFunction: statusFunction,
      payload: sfn.TaskInput.fromObject({
        'operation': 'update',
        'analysisId.$': '$.analysisId',
        'status': status,
        'currentStage': stage,
        'progressPercentage': percentage,
      }),
      resultPath: sfn.JsonPath.DISCARD,
      comment: `Update progress: ${stage} (${percentage}%)`,
    });
    // Retry once on failure, but don't block the pipeline
    task.addRetry({
      errors: ['States.ALL'],
      maxAttempts: 1,
      interval: cdk.Duration.seconds(1),
    });
    return task;
  }

  /**
   * Adds retry policy for retryable errors:
   * - maxAttempts: 3
   * - interval: 2 seconds
   * - backoffRate: 2 (exponential: 2s → 4s → 8s)
   * - maxInterval: 30 seconds
   *
   * Validates: Requirement 5.2
   */
  private addRetryPolicy(task: tasks.LambdaInvoke): void {
    task.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout', 'Lambda.ServiceException', 'Lambda.TooManyRequestsException'],
      maxAttempts: 3,
      interval: cdk.Duration.seconds(2),
      backoffRate: 2,
      maxDelay: cdk.Duration.seconds(30),
    });
  }

  /**
   * Adds non-retryable error handling that updates status to failed.
   * Catches all errors (non-retryable immediately, others after retries exhausted).
   *
   * Validates: Requirement 5.7
   */
  private addNonRetryableCatch(task: tasks.LambdaInvoke): void {
    task.addCatch(this.failState as sfn.State, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });
  }
}
