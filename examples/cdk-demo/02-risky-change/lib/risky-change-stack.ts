import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export class RiskyChangeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- VPC ---
    const vpc = new ec2.Vpc(this, 'ProductionVpc', {
      maxAzs: 2,
      natGateways: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // --- Security Group ---
    const webSecurityGroup = new ec2.SecurityGroup(this, 'WebSecurityGroup', {
      vpc,
      description: 'Security group for web-facing services',
      allowAllOutbound: true,
    });

    // ⚠️  RISKY CHANGE #1: Restricting access from 0.0.0.0/0 to 10.0.0.0/8
    //
    // Previously: allowed HTTP/HTTPS from anywhere (public internet)
    // Now: only allows traffic from internal 10.x.x.x addresses
    //
    // This breaks:
    //   - Public ALB will stop receiving external traffic
    //   - ECS Fargate tasks behind the ALB become unreachable from the internet
    //   - Any external client hitting the service gets connection refused
    //   - Health checks from external monitoring will fail
    webSecurityGroup.addIngressRule(
      ec2.Peer.ipv4('10.0.0.0/8'),
      ec2.Port.tcp(80),
      'Allow HTTP from internal network only'
    );
    webSecurityGroup.addIngressRule(
      ec2.Peer.ipv4('10.0.0.0/8'),
      ec2.Port.tcp(443),
      'Allow HTTPS from internal network only'
    );

    // --- ECS Fargate Service ---
    const cluster = new ecs.Cluster(this, 'ProductionCluster', {
      vpc,
      clusterName: 'blast-radius-demo-cluster',
    });

    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      'WebService',
      {
        cluster,
        cpu: 256,
        memoryLimitMiB: 512,
        desiredCount: 2,
        taskImageOptions: {
          image: ecs.ContainerImage.fromRegistry('amazon/amazon-ecs-sample'),
          containerPort: 80,
        },
        securityGroups: [webSecurityGroup],
        publicLoadBalancer: true,
      }
    );

    fargateService.targetGroup.configureHealthCheck({
      path: '/',
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    // --- Aurora PostgreSQL ---
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'Security group for Aurora PostgreSQL',
    });

    dbSecurityGroup.addIngressRule(
      webSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from web services'
    );

    // ⚠️  RISKY CHANGE #2: Changing instance type from db.r6g.large to db.r6g.xlarge
    //
    // This triggers an instance REPLACEMENT in Aurora. The writer instance will be
    // destroyed and recreated with the new instance type. During the replacement:
    //   - Database connections will be dropped
    //   - Write operations will fail until the new writer is promoted
    //   - Applications without retry logic will throw errors
    //   - If there's no reader instance, there's a full outage window
    const auroraCluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_8,
      }),
      writer: rds.ClusterInstance.provisioned('Writer', {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.XLARGE), // ⚠️ Changed from LARGE
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      defaultDatabaseName: 'appdb',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // --- Lambda Function ---
    const processorFunction = new lambda.Function(this, 'BackgroundProcessor', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Processing event:', JSON.stringify(event));
          return { statusCode: 200, body: 'Processed' };
        };
      `),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [webSecurityGroup],
      timeout: cdk.Duration.seconds(30),
      environment: {
        DB_HOST: auroraCluster.clusterEndpoint.hostname,
        DB_PORT: '5432',
      },
    });

    // Grant the Lambda read access to the database
    auroraCluster.connections.allowFrom(processorFunction, ec2.Port.tcp(5432));

    // --- S3 Bucket ---
    const assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
      bucketName: `blast-radius-demo-assets-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'VpcId', { value: vpc.vpcId });
    new cdk.CfnOutput(this, 'ClusterEndpoint', { value: auroraCluster.clusterEndpoint.hostname });
    new cdk.CfnOutput(this, 'LoadBalancerDns', { value: fargateService.loadBalancer.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'LambdaArn', { value: processorFunction.functionArn });
    new cdk.CfnOutput(this, 'BucketName', { value: assetsBucket.bucketName });
  }
}

// --- App entry point ---
const app = new cdk.App();
new RiskyChangeStack(app, 'BlastRadiusDemoBaseline', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
