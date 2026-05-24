/**
 * Resource criticality configuration.
 *
 * Provides default criticality mappings per resource type and supports
 * custom overrides loaded from configuration.
 */

import type { CriticalityClassification } from '../models/scored-resource';

/** Interface for accessing and configuring resource criticality mappings. */
export interface CriticalityConfig {
  /** Get the criticality classification for a resource type. */
  getCriticality(resourceType: string): CriticalityClassification;
  /** Override or add criticality mappings. */
  setOverrides(overrides: Record<string, CriticalityClassification>): void;
  /** Get all configured mappings (defaults merged with overrides). */
  getMappings(): Record<string, CriticalityClassification>;
}

/** Default criticality mappings for AWS CloudFormation-style resource types. */
const DEFAULT_CFN_MAPPINGS: Record<string, CriticalityClassification> = {
  // Critical
  'AWS::RDS::DBInstance': 'Critical',
  'AWS::DynamoDB::Table': 'Critical',
  'AWS::EKS::Cluster': 'Critical',
  'AWS::ElasticLoadBalancingV2::LoadBalancer': 'Critical',
  'AWS::Route53::HostedZone': 'Critical',

  // High
  'AWS::EC2::Instance': 'High',
  'AWS::Lambda::Function': 'High',
  'AWS::ECS::Service': 'High',
  'AWS::ElastiCache::CacheCluster': 'High',
  'AWS::ApiGateway::RestApi': 'High',

  // Medium
  'AWS::EC2::SecurityGroup': 'Medium',
  'AWS::IAM::Role': 'Medium',
  'AWS::S3::Bucket': 'Medium',
  'AWS::SNS::Topic': 'Medium',
  'AWS::SQS::Queue': 'Medium',

  // Low
  'AWS::CloudWatch::Alarm': 'Low',
  'AWS::CloudFormation::Tag': 'Low',
  'AWS::Logs::LogGroup': 'Low',
  'AWS::SSM::Parameter': 'Low',
};

/** Default criticality mappings for Terraform-style resource types. */
const DEFAULT_TERRAFORM_MAPPINGS: Record<string, CriticalityClassification> = {
  // Critical
  aws_db_instance: 'Critical',
  aws_rds_cluster: 'Critical',
  aws_dynamodb_table: 'Critical',
  aws_eks_cluster: 'Critical',
  aws_lb: 'Critical',
  aws_alb: 'Critical',
  aws_route53_zone: 'Critical',

  // High
  aws_instance: 'High',
  aws_lambda_function: 'High',
  aws_ecs_service: 'High',
  aws_elasticache_cluster: 'High',
  aws_api_gateway_rest_api: 'High',

  // Medium
  aws_security_group: 'Medium',
  aws_iam_role: 'Medium',
  aws_s3_bucket: 'Medium',
  aws_sns_topic: 'Medium',
  aws_sqs_queue: 'Medium',

  // Low
  aws_cloudwatch_metric_alarm: 'Low',
  aws_cloudwatch_log_group: 'Low',
  aws_ssm_parameter: 'Low',
};

/** Combined default mappings for all supported resource type formats. */
const DEFAULT_MAPPINGS: Record<string, CriticalityClassification> = {
  ...DEFAULT_CFN_MAPPINGS,
  ...DEFAULT_TERRAFORM_MAPPINGS,
};

/** The default criticality returned when a resource type is not found in any mapping. */
const DEFAULT_CRITICALITY: CriticalityClassification = 'Medium';

/**
 * Creates a CriticalityConfig instance with default mappings
 * and optional initial overrides.
 */
export function createCriticalityConfig(
  initialOverrides?: Record<string, CriticalityClassification>,
): CriticalityConfig {
  let overrides: Record<string, CriticalityClassification> = { ...(initialOverrides ?? {}) };

  return {
    getCriticality(resourceType: string): CriticalityClassification {
      if (resourceType in overrides) {
        return overrides[resourceType];
      }
      if (resourceType in DEFAULT_MAPPINGS) {
        return DEFAULT_MAPPINGS[resourceType];
      }
      return DEFAULT_CRITICALITY;
    },

    setOverrides(newOverrides: Record<string, CriticalityClassification>): void {
      overrides = { ...overrides, ...newOverrides };
    },

    getMappings(): Record<string, CriticalityClassification> {
      return { ...DEFAULT_MAPPINGS, ...overrides };
    },
  };
}
