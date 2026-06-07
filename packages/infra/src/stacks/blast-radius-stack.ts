import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as path from 'path';
import { Construct } from 'constructs';
import { AnalysisPipeline } from '../constructs/analysis-pipeline.js';
import { BlastRadiusApiGateway } from '../constructs/api-gateway.js';

/**
 * Properties for the BlastRadiusStack.
 */
export interface BlastRadiusStackProps extends cdk.StackProps {
  /** Whether to enable Bedrock-powered risk summaries. Default: false */
  enableBedrockSummary?: boolean;
  /** S3 results bucket lifecycle expiration in days. Default: 90 */
  resultsRetentionDays?: number;
  /** Enable IAM (SigV4) authentication on the API. Set to false for demos. Default: true */
  enableAuth?: boolean;
}

/**
 * BlastRadiusStack defines the complete infrastructure for the
 * Blast Radius Pre-Deploy Visualizer.
 *
 * Resources:
 * - Lambda functions for all handlers
 * - DynamoDB tables (adapter registry, analysis status)
 * - S3 bucket for results with lifecycle policies
 * - API Gateway REST API with SigV4 authorizer
 * - Step Functions state machine
 * - CloudFront distribution with S3 origin for frontend
 * - IAM roles with least-privilege permissions
 *
 * Validates: All Requirements
 */
export class BlastRadiusStack extends cdk.Stack {
  /** The API Gateway REST API */
  public readonly api: BlastRadiusApiGateway;
  /** The Step Functions analysis pipeline */
  public readonly pipeline: AnalysisPipeline;
  /** The CloudFront distribution for the frontend */
  public readonly distribution: cloudfront.Distribution;
  /** The S3 bucket for analysis results */
  public readonly resultsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: BlastRadiusStackProps) {
    super(scope, id, props);

    const enableBedrockSummary = props?.enableBedrockSummary ?? false;
    const resultsRetentionDays = props?.resultsRetentionDays ?? 90;

    // ─── DynamoDB Tables ───────────────────────────────────────────────

    const adapterRegistryTable = new dynamodb.Table(this, 'AdapterRegistryTable', {
      tableName: 'BlastRadius-AdapterRegistry',
      partitionKey: { name: 'formatId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    const analysisStatusTable = new dynamodb.Table(this, 'AnalysisStatusTable', {
      tableName: 'BlastRadius-AnalysisStatus',
      partitionKey: { name: 'analysisId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'ttl',
    });

    // GSI for querying by requesting principal
    analysisStatusTable.addGlobalSecondaryIndex({
      indexName: 'byPrincipal',
      partitionKey: { name: 'requestingPrincipal', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'startedAt', type: dynamodb.AttributeType.STRING },
    });

    // ─── S3 Buckets ────────────────────────────────────────────────────

    this.resultsBucket = new s3.Bucket(this, 'ResultsBucket', {
      bucketName: cdk.Fn.sub('blast-radius-results-${AWS::AccountId}-${AWS::Region}'),
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'ExpireResults',
          expiration: cdk.Duration.days(resultsRetentionDays),
          enabled: true,
        },
        {
          id: 'AbortIncompleteMultipartUploads',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
          enabled: true,
        },
      ],
    });

    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: cdk.Fn.sub('blast-radius-frontend-${AWS::AccountId}-${AWS::Region}'),
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ─── Lambda Functions ──────────────────────────────────────────────

    const lambdasSrcPath = path.join(__dirname, '..', '..', '..', '..', 'lambdas', 'src');
    const sharedRuntime = lambda.Runtime.NODEJS_22_X;
    const sharedArchitecture = lambda.Architecture.ARM_64;
    const sharedTracing = lambda.Tracing.ACTIVE;

    const sharedBundling: lambdaNodejs.BundlingOptions = {
      minify: true,
      sourceMap: true,
      target: 'node22',
      externalModules: [], // Bundle everything including AWS SDK
    };

    // Manifest Ingestion Lambda
    const ingestionFunction = new lambdaNodejs.NodejsFunction(this, 'IngestionFunction', {
      entry: path.join(lambdasSrcPath, 'ingestion', 'handler.ts'),
      handler: 'handler',
      runtime: sharedRuntime,
      architecture: sharedArchitecture,
      tracing: sharedTracing,
      functionName: 'BlastRadius-Ingestion',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      description: 'Validates and ingests resource change manifests',
      environment: {
        ANALYSIS_STATUS_TABLE: analysisStatusTable.tableName,
      },
      bundling: sharedBundling,
    });

    // Adapter Registry Lambda
    const adapterRegistryFunction = new lambdaNodejs.NodejsFunction(this, 'AdapterRegistryFunction', {
      entry: path.join(lambdasSrcPath, 'adapter-registry', 'handler.ts'),
      handler: 'handler',
      runtime: sharedRuntime,
      architecture: sharedArchitecture,
      tracing: sharedTracing,
      functionName: 'BlastRadius-AdapterRegistry',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      description: 'Routes changesets to the appropriate manifest adapter',
      environment: {
        ADAPTER_REGISTRY_TABLE: adapterRegistryTable.tableName,
      },
      bundling: sharedBundling,
    });

    // CloudFormation Adapter Lambda
    const cloudFormationAdapterFunction = new lambdaNodejs.NodejsFunction(this, 'CloudFormationAdapterFunction', {
      entry: path.join(lambdasSrcPath, 'adapters', 'cloudformation', 'handler.ts'),
      handler: 'handler',
      runtime: sharedRuntime,
      architecture: sharedArchitecture,
      tracing: sharedTracing,
      functionName: 'BlastRadius-Adapter-CloudFormation',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      description: 'Converts CloudFormation changesets to canonical manifest format',
      bundling: sharedBundling,
    });

    // Terraform Adapter Lambda
    const terraformAdapterFunction = new lambdaNodejs.NodejsFunction(this, 'TerraformAdapterFunction', {
      entry: path.join(lambdasSrcPath, 'adapters', 'terraform', 'handler.ts'),
      handler: 'handler',
      runtime: sharedRuntime,
      architecture: sharedArchitecture,
      tracing: sharedTracing,
      functionName: 'BlastRadius-Adapter-Terraform',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      description: 'Converts Terraform plan JSON to canonical manifest format',
      bundling: sharedBundling,
    });

    // CDK Adapter Lambda
    const cdkAdapterFunction = new lambdaNodejs.NodejsFunction(this, 'CdkAdapterFunction', {
      entry: path.join(lambdasSrcPath, 'adapters', 'cdk', 'handler.ts'),
      handler: 'handler',
      runtime: sharedRuntime,
      architecture: sharedArchitecture,
      tracing: sharedTracing,
      functionName: 'BlastRadius-Adapter-CDK',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      description: 'Converts CDK cloud assembly diffs to canonical manifest format',
      bundling: sharedBundling,
    });

    // Resource Resolver Lambda
    const resourceResolverFunction = new lambdaNodejs.NodejsFunction(this, 'ResourceResolverFunction', {
      entry: path.join(lambdasSrcPath, 'resource-resolver', 'handler.ts'),
      handler: 'handler',
      runtime: sharedRuntime,
      architecture: sharedArchitecture,
      tracing: sharedTracing,
      functionName: 'BlastRadius-ResourceResolver',
      memorySize: 1024,
      timeout: cdk.Duration.seconds(90),
      description: 'Discovers resource dependencies via AWS Config and Resource Explorer',
      environment: {
        CONFIG_AGGREGATOR_NAME: 'blast-radius-aggregator',
      },
      bundling: sharedBundling,
    });

    // Risk Assessor Lambda
    const riskAssessorFunction = new lambdaNodejs.NodejsFunction(this, 'RiskAssessorFunction', {
      entry: path.join(lambdasSrcPath, 'risk-assessor', 'handler.ts'),
      handler: 'handler',
      runtime: sharedRuntime,
      architecture: sharedArchitecture,
      tracing: sharedTracing,
      functionName: 'BlastRadius-RiskAssessor',
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      description: 'Computes impact scores and classifies risk levels',
      bundling: sharedBundling,
    });

    // Visualization Prep Lambda
    const visualizationPrepFunction = new lambdaNodejs.NodejsFunction(this, 'VisualizationPrepFunction', {
      entry: path.join(lambdasSrcPath, 'visualization-prep', 'handler.ts'),
      handler: 'handler',
      runtime: sharedRuntime,
      architecture: sharedArchitecture,
      tracing: sharedTracing,
      functionName: 'BlastRadius-VisualizationPrep',
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      description: 'Prepares visualization data for frontend rendering',
      environment: {
        RESULTS_BUCKET: this.resultsBucket.bucketName,
      },
      bundling: sharedBundling,
    });

    // Risk Summary Generator Lambda
    const riskSummaryFunction = new lambdaNodejs.NodejsFunction(this, 'RiskSummaryFunction', {
      entry: path.join(lambdasSrcPath, 'risk-summary', 'handler.ts'),
      handler: 'handler',
      runtime: sharedRuntime,
      architecture: sharedArchitecture,
      tracing: sharedTracing,
      functionName: 'BlastRadius-RiskSummary',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      description: 'Generates natural language risk summaries via Amazon Bedrock',
      environment: {
        RESULTS_BUCKET: this.resultsBucket.bucketName,
        ENABLE_BEDROCK: enableBedrockSummary ? 'true' : 'false',
        ENABLE_BEDROCK_SUMMARY: enableBedrockSummary ? 'true' : 'false',
        BEDROCK_MODEL_ID: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      },
      bundling: sharedBundling,
    });

    // Status Lambda
    const statusFunction = new lambdaNodejs.NodejsFunction(this, 'StatusFunction', {
      entry: path.join(lambdasSrcPath, 'status', 'handler.ts'),
      handler: 'handler',
      runtime: sharedRuntime,
      architecture: sharedArchitecture,
      tracing: sharedTracing,
      functionName: 'BlastRadius-Status',
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      description: 'Manages analysis status tracking in DynamoDB',
      environment: {
        ANALYSIS_STATUS_TABLE: analysisStatusTable.tableName,
      },
      bundling: sharedBundling,
    });

    // Pipeline Failure Handler Lambda
    const failureHandlerFunction = new lambdaNodejs.NodejsFunction(this, 'FailureHandlerFunction', {
      entry: path.join(lambdasSrcPath, 'pipeline', 'failure-handler.ts'),
      handler: 'handler',
      runtime: sharedRuntime,
      architecture: sharedArchitecture,
      tracing: sharedTracing,
      functionName: 'BlastRadius-FailureHandler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      description: 'Handles pipeline failures and stores partial results',
      environment: {
        RESULTS_BUCKET: this.resultsBucket.bucketName,
        ANALYSIS_STATUS_TABLE: analysisStatusTable.tableName,
      },
      bundling: sharedBundling,
    });

    // Results Lambda
    const resultsFunction = new lambdaNodejs.NodejsFunction(this, 'ResultsFunction', {
      entry: path.join(lambdasSrcPath, 'results', 'handler.ts'),
      handler: 'handler',
      runtime: sharedRuntime,
      architecture: sharedArchitecture,
      tracing: sharedTracing,
      functionName: 'BlastRadius-Results',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      description: 'Retrieves analysis results with authorization checks',
      environment: {
        RESULTS_BUCKET: this.resultsBucket.bucketName,
        ANALYSIS_STATUS_TABLE: analysisStatusTable.tableName,
      },
      bundling: sharedBundling,
    });

    // ─── IAM Permissions (Least-Privilege) ─────────────────────────────

    // Ingestion: write to status table
    analysisStatusTable.grantWriteData(ingestionFunction);

    // Adapter Registry: read from adapter registry table, invoke adapter Lambdas
    adapterRegistryTable.grantReadData(adapterRegistryFunction);
    cloudFormationAdapterFunction.grantInvoke(adapterRegistryFunction);
    terraformAdapterFunction.grantInvoke(adapterRegistryFunction);
    cdkAdapterFunction.grantInvoke(adapterRegistryFunction);

    // Seed the adapter registry table with built-in adapters
    const adapterEntries = [
      { formatId: 'cloudformation', functionRef: cloudFormationAdapterFunction, displayName: 'CloudFormation Adapter' },
      { formatId: 'terraform-plan', functionRef: terraformAdapterFunction, displayName: 'Terraform Adapter' },
      { formatId: 'cdk', functionRef: cdkAdapterFunction, displayName: 'CDK Adapter' },
    ];

    for (const entry of adapterEntries) {
      const seedResource = new cdk.custom_resources.AwsCustomResource(this, `SeedAdapter-${entry.formatId}`, {
        onCreate: {
          service: 'DynamoDB',
          action: 'putItem',
          parameters: {
            TableName: adapterRegistryTable.tableName,
            Item: {
              formatId: { S: entry.formatId },
              adapterLambdaArn: { S: entry.functionRef.functionArn },
              displayName: { S: entry.displayName },
              version: { S: '1.0.0' },
              registeredAt: { S: new Date().toISOString() },
            },
          },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(`adapter-seed-${entry.formatId}`),
        },
        onUpdate: {
          service: 'DynamoDB',
          action: 'putItem',
          parameters: {
            TableName: adapterRegistryTable.tableName,
            Item: {
              formatId: { S: entry.formatId },
              adapterLambdaArn: { S: entry.functionRef.functionArn },
              displayName: { S: entry.displayName },
              version: { S: '1.0.0' },
              registeredAt: { S: new Date().toISOString() },
            },
          },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(`adapter-seed-${entry.formatId}`),
        },
        policy: cdk.custom_resources.AwsCustomResourcePolicy.fromSdkCalls({
          resources: [adapterRegistryTable.tableArn],
        }),
        installLatestAwsSdk: false,
      });
      seedResource.node.addDependency(adapterRegistryTable);
    }

    // Resource Resolver: read AWS Config and Resource Explorer
    resourceResolverFunction.addToRolePolicy(new iam.PolicyStatement({
      sid: 'AllowConfigAdvancedQueries',
      effect: iam.Effect.ALLOW,
      actions: [
        'config:SelectAggregateResourceConfig',
        'config:SelectResourceConfig',
        'config:GetResourceConfigHistory',
        'config:ListDiscoveredResources',
      ],
      resources: ['*'],
    }));
    resourceResolverFunction.addToRolePolicy(new iam.PolicyStatement({
      sid: 'AllowResourceExplorer',
      effect: iam.Effect.ALLOW,
      actions: [
        'resource-explorer-2:Search',
        'resource-explorer-2:GetView',
      ],
      resources: ['*'],
    }));

    // Visualization Prep: write to results bucket
    this.resultsBucket.grantWrite(visualizationPrepFunction);

    // Risk Summary: invoke Bedrock, read/write to results bucket
    this.resultsBucket.grantReadWrite(riskSummaryFunction);
    if (enableBedrockSummary) {
      riskSummaryFunction.addToRolePolicy(new iam.PolicyStatement({
        sid: 'AllowBedrockInvoke',
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:*:${cdk.Aws.ACCOUNT_ID}:inference-profile/*`,
          'arn:aws:bedrock:*:*:inference-profile/*',
        ],
      }));
    }

    // Status: read/write to status table
    analysisStatusTable.grantReadWriteData(statusFunction);

    // Failure Handler: write to results bucket, write to status table
    this.resultsBucket.grantWrite(failureHandlerFunction);
    analysisStatusTable.grantWriteData(failureHandlerFunction);

    // Results: read from results bucket, read from status table
    this.resultsBucket.grantRead(resultsFunction);
    analysisStatusTable.grantReadData(resultsFunction);

    // ─── Step Functions State Machine ──────────────────────────────────

    this.pipeline = new AnalysisPipeline(this, 'AnalysisPipeline', {
      ingestionFunction,
      adapterRegistryFunction,
      resourceResolverFunction,
      riskAssessorFunction,
      visualizationPrepFunction,
      riskSummaryFunction,
      statusFunction,
    });

    // Grant the state machine permission to invoke all Lambda functions
    ingestionFunction.grantInvoke(this.pipeline.stateMachine);
    adapterRegistryFunction.grantInvoke(this.pipeline.stateMachine);
    resourceResolverFunction.grantInvoke(this.pipeline.stateMachine);
    riskAssessorFunction.grantInvoke(this.pipeline.stateMachine);
    visualizationPrepFunction.grantInvoke(this.pipeline.stateMachine);
    riskSummaryFunction.grantInvoke(this.pipeline.stateMachine);
    statusFunction.grantInvoke(this.pipeline.stateMachine);

    // ─── API Gateway ───────────────────────────────────────────────────

    // Single API handler Lambda (router pattern) for all API Gateway routes
    const apiFunction = new lambdaNodejs.NodejsFunction(this, 'ApiFunction', {
      entry: path.join(lambdasSrcPath, 'api', 'handler.ts'),
      handler: 'handler',
      runtime: sharedRuntime,
      architecture: sharedArchitecture,
      tracing: sharedTracing,
      functionName: 'BlastRadius-Api',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      description: 'Unified API handler for all Blast Radius API routes',
      environment: {
        STATE_MACHINE_ARN: this.pipeline.stateMachine.stateMachineArn,
        STATUS_TABLE: analysisStatusTable.tableName,
        ADAPTER_REGISTRY_TABLE: adapterRegistryTable.tableName,
        RESULTS_BUCKET: this.resultsBucket.bucketName,
      },
      bundling: sharedBundling,
    });

    // Grant API function permissions
    this.pipeline.stateMachine.grantStartExecution(apiFunction);
    analysisStatusTable.grantReadWriteData(apiFunction);
    adapterRegistryTable.grantReadData(apiFunction);
    this.resultsBucket.grantRead(apiFunction);

    this.api = new BlastRadiusApiGateway(this, 'ApiGateway', {
      apiFunction,
      enableAuth: props?.enableAuth ?? true,
    });

    // ─── CloudFront Distribution ───────────────────────────────────────

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'FrontendOAI', {
      comment: 'Blast Radius Frontend OAI',
    });
    frontendBucket.grantRead(originAccessIdentity);

    this.distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      comment: 'Blast Radius Visualizer Frontend',
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // ─── CloudWatch Log Groups ─────────────────────────────────────────

    const logRetention = logs.RetentionDays.TWO_WEEKS;

    new logs.LogGroup(this, 'IngestionLogGroup', {
      logGroupName: `/aws/lambda/${ingestionFunction.functionName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'AdapterRegistryLogGroup', {
      logGroupName: `/aws/lambda/${adapterRegistryFunction.functionName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'CloudFormationAdapterLogGroup', {
      logGroupName: `/aws/lambda/${cloudFormationAdapterFunction.functionName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'TerraformAdapterLogGroup', {
      logGroupName: `/aws/lambda/${terraformAdapterFunction.functionName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'CdkAdapterLogGroup', {
      logGroupName: `/aws/lambda/${cdkAdapterFunction.functionName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'ResourceResolverLogGroup', {
      logGroupName: `/aws/lambda/${resourceResolverFunction.functionName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'RiskAssessorLogGroup', {
      logGroupName: `/aws/lambda/${riskAssessorFunction.functionName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'VisualizationPrepLogGroup', {
      logGroupName: `/aws/lambda/${visualizationPrepFunction.functionName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'RiskSummaryLogGroup', {
      logGroupName: `/aws/lambda/${riskSummaryFunction.functionName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'StatusLogGroup', {
      logGroupName: `/aws/lambda/${statusFunction.functionName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'FailureHandlerLogGroup', {
      logGroupName: `/aws/lambda/${failureHandlerFunction.functionName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'ResultsLogGroup', {
      logGroupName: `/aws/lambda/${resultsFunction.functionName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/aws/lambda/${apiFunction.functionName}`,
      retention: logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── CloudWatch Alarms ─────────────────────────────────────────────

    // Alarm: Step Functions execution failures
    new cloudwatch.Alarm(this, 'PipelineFailureAlarm', {
      alarmName: 'BlastRadius-PipelineExecutionsFailed',
      alarmDescription: 'Triggers when the analysis pipeline state machine has failed executions',
      metric: this.pipeline.stateMachine.metricFailed({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm: Step Functions execution timeouts
    new cloudwatch.Alarm(this, 'PipelineTimeoutAlarm', {
      alarmName: 'BlastRadius-PipelineExecutionsTimedOut',
      alarmDescription: 'Triggers when the analysis pipeline state machine has timed-out executions',
      metric: this.pipeline.stateMachine.metricTimedOut({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm: High Lambda error rate on the API function (API entry point)
    new cloudwatch.Alarm(this, 'ApiFunctionErrorAlarm', {
      alarmName: 'BlastRadius-ApiFunctionErrors',
      alarmDescription: 'Triggers when the API Lambda function has elevated error rates',
      metric: apiFunction.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ─── Stack Outputs ─────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'ResultsBucketName', {
      value: this.resultsBucket.bucketName,
      description: 'S3 bucket for analysis results',
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'S3 bucket for frontend static assets',
    });

    // Deploy runtime config to the frontend bucket so it knows the API URL
    new cdk.custom_resources.AwsCustomResource(this, 'FrontendConfig', {
      onUpdate: {
        service: 'S3',
        action: 'putObject',
        parameters: {
          Bucket: frontendBucket.bucketName,
          Key: 'config.json',
          Body: JSON.stringify({
            apiBaseUrl: this.api.api.url,
          }),
          ContentType: 'application/json',
          CacheControl: 'no-cache, no-store, must-revalidate',
        },
        physicalResourceId: cdk.custom_resources.PhysicalResourceId.of('frontend-config'),
      },
      onCreate: {
        service: 'S3',
        action: 'putObject',
        parameters: {
          Bucket: frontendBucket.bucketName,
          Key: 'config.json',
          Body: JSON.stringify({
            apiBaseUrl: this.api.api.url,
          }),
          ContentType: 'application/json',
          CacheControl: 'no-cache, no-store, must-revalidate',
        },
        physicalResourceId: cdk.custom_resources.PhysicalResourceId.of('frontend-config'),
      },
      policy: cdk.custom_resources.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [frontendBucket.arnForObjects('config.json')],
      }),
      installLatestAwsSdk: false,
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name for the frontend',
    });

    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: this.pipeline.stateMachine.stateMachineArn,
      description: 'Step Functions state machine ARN',
    });

    new cdk.CfnOutput(this, 'AdapterRegistryTableName', {
      value: adapterRegistryTable.tableName,
      description: 'DynamoDB table for adapter registry',
    });

    new cdk.CfnOutput(this, 'AnalysisStatusTableName', {
      value: analysisStatusTable.tableName,
      description: 'DynamoDB table for analysis status tracking',
    });
  }
}
