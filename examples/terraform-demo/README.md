# Terraform Demo

A two-step Terraform project demonstrating Blast Radius analysis on a realistic infrastructure change.

**Scenario:** You have a production VPC with EC2 web servers, an RDS database, an ALB, and a Lambda function. Someone proposes removing the HTTPS ingress rule from the shared security group. Blast Radius shows you exactly what breaks.

## Prerequisites

- AWS account with permissions to create VPC, EC2, RDS, ALB, Lambda resources
- [Terraform CLI](https://developer.hashicorp.com/terraform/install) v1.5+
- AWS CLI configured (`aws configure`)
- An existing EC2 key pair (or remove the `key_name` reference)

## Step 1: Deploy the Baseline

```bash
cd 01-baseline
terraform init
terraform apply -var="db_password=YourSecurePassword123!"
```

This creates:
- VPC with public and private subnets
- Security group allowing HTTP (80) and HTTPS (443)
- 2 EC2 instances (web servers) attached to the security group
- RDS PostgreSQL instance in the private subnet
- Application Load Balancer
- Lambda function for API processing

## Step 2: Generate the Risky Change Plan

```bash
cd ../02-risky-change
terraform init
terraform plan -var="db_password=YourSecurePassword123!" -out=risky.tfplan
terraform show -json risky.tfplan > risky.tfplan.json
```

The risky change removes the HTTPS (port 443) ingress rule from the security group. This cascades:
- ALB health checks may fail (they use HTTPS)
- EC2 instances lose HTTPS traffic
- Any service routing through the ALB is affected

## Step 3: Run Blast Radius Analysis

```bash
blast-radius analyze --format terraform --file risky.tfplan.json
```

Or submit via the API:

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d @risky.tfplan.json
```

## Step 4: View Results

Open the Blast Radius GUI and navigate to the analysis. You'll see:
- The security group as the root node (yellow, direct change)
- EC2 instances, ALB, and RDS as downstream nodes (colored by risk)
- Dependency chains showing how the risk flows
- Impact scores based on depth, criticality, and change type

## Cleanup

```bash
cd 01-baseline
terraform destroy -var="db_password=YourSecurePassword123!"
```

## Cost Warning

This demo creates real AWS resources that incur charges:
- 2x t3.micro EC2 instances (~$0.02/hr total)
- 1x db.t3.micro RDS instance (~$0.017/hr)
- 1x ALB (~$0.0225/hr)
- NAT Gateway (~$0.045/hr)

**Estimated cost:** ~$0.10/hr. Destroy resources when done.
