import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/**
 * Properties for the BlastRadiusApiGateway construct.
 */
export interface BlastRadiusApiGatewayProps {
  /** Lambda function that handles POST /analyze requests (manifest ingestion + adapter routing) */
  analyzeFunction: lambda.IFunction;
  /** Lambda function that handles GET /analyze/{analysisId} status and results */
  statusFunction: lambda.IFunction;
  /** Lambda function that handles GET /analyze/{analysisId}/export */
  exportFunction: lambda.IFunction;
  /** Lambda function that handles GET /formats (list supported adapter formats) */
  formatsFunction: lambda.IFunction;
}

/**
 * BlastRadiusApiGateway construct defines the API Gateway REST API
 * for the Blast Radius Pre-Deploy Visualizer.
 *
 * Endpoints:
 * - POST /analyze - Submit a manifest or native changeset for analysis
 * - GET /analyze/{analysisId} - Get analysis status and results
 * - GET /analyze/{analysisId}/export - Export results as JSON or PDF
 * - GET /formats - List supported adapter formats
 *
 * Authentication: IAM (SigV4) on all endpoints.
 * Timeout: 180 seconds with partial results on timeout.
 *
 * Validates: Requirements 7.1, 7.8, 9.1
 */
export class BlastRadiusApiGateway extends Construct {
  /** The API Gateway REST API */
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: BlastRadiusApiGatewayProps) {
    super(scope, id);

    // Create the REST API with IAM authorization as default
    this.api = new apigateway.RestApi(this, 'BlastRadiusApi', {
      restApiName: 'BlastRadiusVisualizerApi',
      description: 'Blast Radius Pre-Deploy Visualizer REST API',
      defaultMethodOptions: {
        authorizationType: apigateway.AuthorizationType.IAM,
      },
      deployOptions: {
        stageName: 'v1',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    // --- Lambda integrations with 180-second timeout ---

    const analyzeIntegration = new apigateway.LambdaIntegration(props.analyzeFunction, {
      timeout: cdk.Duration.seconds(180),
      proxy: true,
    });

    const statusIntegration = new apigateway.LambdaIntegration(props.statusFunction, {
      timeout: cdk.Duration.seconds(180),
      proxy: true,
    });

    const exportIntegration = new apigateway.LambdaIntegration(props.exportFunction, {
      timeout: cdk.Duration.seconds(180),
      proxy: true,
    });

    const formatsIntegration = new apigateway.LambdaIntegration(props.formatsFunction, {
      timeout: cdk.Duration.seconds(180),
      proxy: true,
    });

    // --- Define API resources and methods ---

    // POST /analyze
    const analyzeResource = this.api.root.addResource('analyze');
    analyzeResource.addMethod('POST', analyzeIntegration, {
      authorizationType: apigateway.AuthorizationType.IAM,
      operationName: 'SubmitAnalysis',
    });

    // GET /analyze/{analysisId}
    const analysisIdResource = analyzeResource.addResource('{analysisId}');
    analysisIdResource.addMethod('GET', statusIntegration, {
      authorizationType: apigateway.AuthorizationType.IAM,
      operationName: 'GetAnalysisStatus',
    });

    // GET /analyze/{analysisId}/export
    const exportResource = analysisIdResource.addResource('export');
    exportResource.addMethod('GET', exportIntegration, {
      authorizationType: apigateway.AuthorizationType.IAM,
      operationName: 'ExportAnalysisResults',
    });

    // GET /formats
    const formatsResource = this.api.root.addResource('formats');
    formatsResource.addMethod('GET', formatsIntegration, {
      authorizationType: apigateway.AuthorizationType.IAM,
      operationName: 'ListSupportedFormats',
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'Blast Radius Visualizer API URL',
    });
  }
}
