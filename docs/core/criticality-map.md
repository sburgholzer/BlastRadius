← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Criticality Map (criticality-map.ts)

A lookup table that answers: "how important is this type of resource?"

When the Risk Assessor scores a resource, it needs to know if it's looking at a production database (very important) or a CloudWatch alarm (not critical). This file encodes that institutional knowledge.

**The idea:** Not all resources are equal. Deleting an RDS database is catastrophic. Deleting a log group is annoying but recoverable.

**Default mappings (built-in):**

| Criticality | Score | Resource Types |
|-------------|-------|---------------|
| Critical (100) | Most dangerous | RDS databases, DynamoDB tables, EKS clusters, Load Balancers, Route53 zones |
| High (75) | Important | EC2 instances, Lambda functions, ECS services, ElastiCache, API Gateway |
| Medium (50) | Moderate | Security groups, IAM roles, S3 buckets, SNS topics, SQS queues |
| Low (25) | Least concern | CloudWatch alarms, tags, log groups, SSM parameters |

Supports both CloudFormation-style names (`AWS::RDS::DBInstance`) and Terraform-style names (`aws_db_instance`) so it works regardless of which adapter produced the manifest.

**Unknown resource types default to Medium (50)** — a safe middle ground. Better to slightly over-estimate risk than miss something.

**Customizable:** Teams can override defaults without changing source code:
```typescript
const config = createCriticalityConfig();
config.setOverrides({
  'AWS::S3::Bucket': 'Critical',  // "our buckets hold production data"
});
```
