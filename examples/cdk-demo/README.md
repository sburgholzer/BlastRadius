# CDK Demo

A two-step CDK project demonstrating Blast Radius analysis on a realistic infrastructure change.

**Scenario:** You have a production ECS Fargate service with an Aurora database, ALB, Lambda function, and S3 bucket. Someone proposes restricting the security group from public access to internal-only AND resizing the database (which triggers a replacement). Blast Radius shows you the full impact.

## Prerequisites

- AWS account with permissions to create VPC, ECS, RDS, ALB, Lambda, S3 resources
- [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html) v2.150+
- Node.js 18+
- AWS CLI configured (`aws configure`)
- CDK bootstrapped in your account (`cdk bootstrap`)

## Step 1: Deploy the Baseline

```bash
cd 01-baseline
npm install
npx cdk deploy
```

This creates:
- VPC with 2 AZs (public + private subnets)
- Security group allowing HTTP/HTTPS from 0.0.0.0/0
- ECS Fargate service running a web application
- Aurora PostgreSQL cluster in private subnets
- Application Load Balancer
- Lambda function for background processing
- S3 bucket for static assets

## Step 2: Generate the Risky Change Diff

```bash
cd ../02-risky-change
npm install
npx cdk diff 2>&1 | tee cdk-diff.txt
```

The risky change does two things:
1. **Restricts security group** from `0.0.0.0/0` to `10.0.0.0/8` — only internal traffic allowed
2. **Resizes Aurora** from `db.r6g.large` to `db.r6g.xlarge` — triggers instance replacement

Both changes cascade through the infrastructure.

## Step 3: Run Blast Radius Analysis

```bash
# Generate CloudFormation template for analysis
npx cdk synth > template.json

blast-radius analyze --format cdk --file template.json
```

Or use the CDK diff output directly:

```bash
blast-radius analyze --format cdk --diff cdk-diff.txt
```

## Step 4: View Results

Open the Blast Radius GUI and navigate to the analysis. You'll see:
- Security group and Aurora cluster as root nodes (direct changes)
- ECS service, ALB, Lambda as downstream nodes
- Risk scores reflecting both the access restriction and the database replacement
- Cross-resource dependency chains

## Cleanup

```bash
cd 01-baseline
npx cdk destroy
```

## Cost Warning

This demo creates real AWS resources that incur charges:
- ECS Fargate tasks (~$0.04/hr per task)
- Aurora db.r6g.large (~$0.26/hr)
- ALB (~$0.0225/hr)
- NAT Gateways (~$0.09/hr for 2 AZs)

**Estimated cost:** ~$0.45/hr. Destroy resources when done.
