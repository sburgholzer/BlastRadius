# CDK Demo

A two-step CDK project demonstrating Blast Radius analysis on a realistic infrastructure change.

**Scenario:** You have a production ECS Fargate service with an Aurora database, ALB, Lambda function, and S3 bucket. Someone proposes restricting the security group from public access to internal-only AND resizing the database. Blast Radius shows you the full impact.

## Prerequisites

- AWS account with permissions to create VPC, ECS, RDS, ALB, Lambda, S3 resources
- [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html) v2.150+
- Node.js 18+
- AWS CLI configured (`aws configure`)
- CDK bootstrapped in your account (`cdk bootstrap`)
- Blast Radius infrastructure deployed (`packages/infra`)

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
- Aurora PostgreSQL 15.8 cluster in private subnets
- Application Load Balancer
- Lambda function for background processing
- S3 bucket for static assets

Both `01-baseline` and `02-risky-change` include `cdk.json` for easy synthesis — the CDK CLI knows how to find the app entry point automatically.

## Step 2: Run Blast Radius Analysis

From the risky-change directory:

```bash
cd ../02-risky-change
npm install
BLAST_RADIUS_API_URL=<your-api-url> blast-radius analyze --format cdk --stack BlastRadiusDemoBaseline --ai-gate
```

This automatically:
1. Synthesizes the CDK app (reads `cdk.json`)
2. Creates a read-only CloudFormation changeset against the deployed stack
3. Describes the changeset to get structured change data
4. Deletes the changeset (never executed)
5. Submits to Blast Radius for analysis
6. Polls for results
7. Evaluates AI gate (pass/fail)

### CI mode with both gates:

```bash
blast-radius analyze --format cdk --stack BlastRadiusDemoBaseline --threshold 75 --ai-gate --ci
```

### Alternative: Generate + Analyze workflow

Save the changeset for inspection or later use:

```bash
# Generate only (no submission):
blast-radius generate --format cdk --stack BlastRadiusDemoBaseline --output changeset.json

# Submit separately:
blast-radius analyze --format cloudformation --input changeset.json --threshold 75 --ai-gate
```

### Text diff only (no analysis):

```bash
npx cdk diff
```

## What the Risky Change Does

1. **Restricts security group** from `0.0.0.0/0` to `10.0.0.0/8` — only internal traffic allowed
2. **Resizes Aurora** from `db.r6g.large` to `db.r6g.xlarge` — triggers instance modification

Both changes cascade through the infrastructure. The changeset shows 7 affected resources:
- WebSecurityGroup (direct change)
- AuroraClusterWriter (direct change)
- BackgroundProcessor Lambda (cascading — VpcConfig references the SG)
- WebService ECS (cascading — NetworkConfiguration references the SG)
- DatabaseSecurityGroupIngress (cascading — SourceSecurityGroupId)
- WebSecurityGroupIngress from LB (cascading — GroupId)
- WebServiceLBSecurityGroupEgress (cascading — DestinationSecurityGroupId)

## Step 3: View Results

Open the Blast Radius frontend and navigate to the analysis. You'll see:
- Security group and Aurora cluster as blue root nodes (direct changes)
- ECS service, Lambda as downstream nodes colored by risk
- Risk scores reflecting both the access restriction and the database resize
- Cross-resource dependency chains
- AI-generated summary explaining the cascading impact

## Project Structure

```
01-baseline/
├── cdk.json              ← CDK app config (used by cdk-diff automatically)
├── lib/baseline-stack.ts ← The "before" infrastructure
├── package.json          ← includes ts-node as dev dependency
└── tsconfig.json

02-risky-change/
├── cdk.json              ← CDK app config (same stack name as baseline)
├── lib/risky-stack.ts    ← The "after" with security + database changes
├── package.json          ← includes ts-node as dev dependency
└── tsconfig.json
```

Both projects use the same stack name (`BlastRadiusDemoBaseline`) so the risky-change produces a diff against the deployed baseline.

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
