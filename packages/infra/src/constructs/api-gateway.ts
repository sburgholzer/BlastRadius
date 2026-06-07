import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/**
 * Properties for the BlastRadiusApiGateway construct.
 */
export interface BlastRadiusApiGatewayProps {
  /** Single Lambda function that handles all API routes (router pattern) */
  apiFunction: lambda.IFunction;
  /** Enable IAM (SigV4) authentication. Set to false for demos. Default: true */
  enableAuth?: boolean;
}

/**
 * BlastRadiusApiGateway construct defines the API Gateway REST API
 * for the Blast Radius Pre-Deploy Visualizer.
 *
 * All routes are handled by a single Lambda function using the router pattern.
 *
 * Endpoints:
 * - POST /analyze - Submit a manifest or native changeset for analysis
 * - GET /analyze/{analysisId} - Get analysis status and results
 * - GET /analyze/{analysisId}/export - Export results as JSON or PDF
 * - GET /formats - List supported adapter formats
 * - GET /analyses - List all analyses
 *
 * Authentication: IAM (SigV4) on all endpoints.
 *
 * Validates: Requirements 7.1, 7.8, 9.1
 */
export class BlastRadiusApiGateway extends Construct {
  /** The API Gateway REST API */
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: BlastRadiusApiGatewayProps) {
    super(scope, id);

    const enableAuth = props.enableAuth ?? true;
    const authType = enableAuth ? apigateway.AuthorizationType.IAM : apigateway.AuthorizationType.NONE;

    // Create the REST API
    this.api = new apigateway.RestApi(this, 'BlastRadiusApi', {
      restApiName: 'BlastRadiusVisualizerApi',
      description: 'Blast Radius Pre-Deploy Visualizer REST API',
      ...(enableAuth
        ? { defaultMethodOptions: { authorizationType: apigateway.AuthorizationType.IAM } }
        : { defaultCorsPreflightOptions: {
            allowOrigins: apigateway.Cors.ALL_ORIGINS,
            allowMethods: apigateway.Cors.ALL_METHODS,
            allowHeaders: ['Content-Type', 'Authorization'],
          }}
      ),
      deployOptions: {
        stageName: 'v1',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    // Single Lambda integration for all routes
    const apiIntegration = new apigateway.LambdaIntegration(props.apiFunction, {
      timeout: cdk.Duration.seconds(29),
      proxy: true,
    });

    // --- Define API resources and methods ---

    // POST /analyze
    const analyzeResource = this.api.root.addResource('analyze');
    analyzeResource.addMethod('POST', apiIntegration, {
      authorizationType: authType,
      operationName: 'SubmitAnalysis',
    });

    // GET /analyze/{analysisId}
    const analysisIdResource = analyzeResource.addResource('{analysisId}');
    analysisIdResource.addMethod('GET', apiIntegration, {
      authorizationType: authType,
      operationName: 'GetAnalysisStatus',
    });

    // GET /analyze/{analysisId}/export
    const exportResource = analysisIdResource.addResource('export');
    exportResource.addMethod('GET', apiIntegration, {
      authorizationType: authType,
      operationName: 'ExportAnalysisResults',
    });

    // GET /formats
    const formatsResource = this.api.root.addResource('formats');
    formatsResource.addMethod('GET', apiIntegration, {
      authorizationType: authType,
      operationName: 'ListSupportedFormats',
    });

    // GET /analyses
    const analysesResource = this.api.root.addResource('analyses');
    analysesResource.addMethod('GET', apiIntegration, {
      authorizationType: authType,
      operationName: 'ListAnalyses',
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'Blast Radius Visualizer API URL',
    });
  }
}
