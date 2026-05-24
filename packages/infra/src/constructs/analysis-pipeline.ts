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

  constructor(scope: Construct, id: string, props: AnalysisPipelineProps) {
    super(scope, id);

    // --- Define states ---

    // 1. Ingestion - Invoke ingestion Lambda
    const ingestion = new tasks.LambdaInvoke(this, 'Ingestion', {
      lambdaFunction: props.ingestionFunction,
      outputPath: '$.Payload',
      comment: 'Validate and ingest the resource change manifest',
    });
    this.addRetryPolicy(ingestion);
    this.addNonRetryableCatch(ingestion);

    // 2. AdapterConversion - Conditional: if sourceFormat !== 'canonical', invoke adapter registry
    const adapterConversion = new tasks.LambdaInvoke(this, 'AdapterConversion', {
      lambdaFunction: props.adapterRegistryFunction,
      outputPath: '$.Payload',
      comment: 'Convert native changeset format to canonical manifest',
    });
    this.addRetryPolicy(adapterConversion);
    this.addNonRetryableCatch(adapterConversion);

    // 3. Discovery - Invoke resource resolver
    const discovery = new tasks.LambdaInvoke(this, 'Discovery', {
      lambdaFunction: props.resourceResolverFunction,
      outputPath: '$.Payload',
      comment: 'Discover resource dependencies via AWS Config and Resource Explorer',
    });
    this.addRetryPolicy(discovery);
    this.addNonRetryableCatch(discovery);

    // 4. Scoring - Invoke risk assessor
    const scoring = new tasks.LambdaInvoke(this, 'Scoring', {
      lambdaFunction: props.riskAssessorFunction,
      outputPath: '$.Payload',
      comment: 'Compute impact scores and classify risk levels',
    });
    this.addRetryPolicy(scoring);
    this.addNonRetryableCatch(scoring);

    // 5. VisualizationPrep - Invoke visualization prep
    const visualizationPrep = new tasks.LambdaInvoke(this, 'VisualizationPrep', {
      lambdaFunction: props.visualizationPrepFunction,
      outputPath: '$.Payload',
      comment: 'Prepare visualization data for frontend rendering',
    });
    this.addRetryPolicy(visualizationPrep);
    this.addNonRetryableCatch(visualizationPrep);

    // 6. SummaryGeneration - Conditional: if enableSummary === true, invoke risk summary generator
    const summaryGeneration = new tasks.LambdaInvoke(this, 'SummaryGeneration', {
      lambdaFunction: props.riskSummaryFunction,
      outputPath: '$.Payload',
      comment: 'Generate natural language risk summary via Amazon Bedrock',
    });
    this.addRetryPolicy(summaryGeneration);
    this.addNonRetryableCatch(summaryGeneration);

    // 7. Complete - Success state
    const complete = new sfn.Succeed(this, 'Complete', {
      comment: 'Analysis pipeline completed successfully',
    });

    // --- Define conditional logic ---

    // Choice: should we run adapter conversion?
    const needsAdapterConversion = new sfn.Choice(this, 'NeedsAdapterConversion')
      .when(
        sfn.Condition.not(
          sfn.Condition.stringEquals('$.sourceFormat', 'canonical')
        ),
        adapterConversion.next(discovery)
      )
      .otherwise(discovery);

    // Choice: should we generate a summary?
    const needsSummaryGeneration = new sfn.Choice(this, 'NeedsSummaryGeneration')
      .when(
        sfn.Condition.booleanEquals('$.enableSummary', true),
        summaryGeneration.next(complete)
      )
      .otherwise(complete);

    // --- Chain the states ---
    // Ingestion → (AdapterConversion?) → Discovery → Scoring → VisualizationPrep → (SummaryGeneration?) → Complete
    ingestion.next(needsAdapterConversion);
    discovery.next(scoring);
    scoring.next(visualizationPrep);
    visualizationPrep.next(needsSummaryGeneration);

    // --- Create the state machine ---
    this.stateMachine = new sfn.StateMachine(this, 'AnalysisPipelineStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(ingestion),
      timeout: cdk.Duration.seconds(120),
      comment: 'Blast Radius Analysis Pipeline - orchestrates end-to-end impact analysis',
    });
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
   * Adds non-retryable error handling that causes immediate failure.
   * Non-retryable errors: ValidationError, PermissionDenied, ResourceNotFound
   *
   * Validates: Requirement 5.7
   */
  private addNonRetryableCatch(task: tasks.LambdaInvoke): void {
    const failState = new sfn.Fail(this, `${task.id}Failed`, {
      cause: 'Non-retryable error encountered',
      error: 'NonRetryableError',
    });

    task.addCatch(failState, {
      errors: NON_RETRYABLE_ERRORS,
      resultPath: '$.error',
    });
  }
}
