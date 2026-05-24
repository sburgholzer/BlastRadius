# Blast Radius Examples

Three demo approaches for exploring the Blast Radius Pre-Deploy Visualizer. Pick the one that fits your situation.

## Demo Options

| Demo | AWS Account Needed? | Best For |
|------|-------------------|----------|
| [Mock Server](./mock-server/) | No | Frontend development, quick demos, presentations |
| [Terraform Demo](./terraform-demo/) | Yes | Terraform users, realistic end-to-end flow |
| [CDK Demo](./cdk-demo/) | Yes | CDK users, realistic end-to-end flow |

## 1. Mock Server (No AWS Required)

A local Express server that serves pre-built analysis results. Connect the frontend to `localhost:3001` and immediately see the interactive graph with realistic data — no AWS credentials, no infrastructure deployment.

**Use when:**
- Developing or testing the frontend
- Giving a demo or presentation
- Exploring the UI without deploying anything

```bash
cd mock-server
npm install
npm start
# Frontend connects to http://localhost:3001
```

## 2. Terraform Demo (AWS Required)

A two-step Terraform project. Deploy a baseline VPC + EC2 + RDS environment, then generate a plan for a risky security group change. Run `blast-radius analyze` against the plan to see real dependency analysis.

**Use when:**
- You use Terraform and want to see the tool in your workflow
- You want a real end-to-end analysis (not mocked data)
- You're evaluating Blast Radius for your team

**Prerequisites:** AWS account, Terraform CLI, AWS CLI configured.

## 3. CDK Demo (AWS Required)

A two-step CDK project. Deploy a baseline ECS + Aurora + Lambda stack, then deploy a risky change that restricts security group access and resizes the database. Run `blast-radius analyze` against the CDK diff.

**Use when:**
- You use CDK and want to see the tool in your workflow
- You want to see how CDK diffs translate to blast radius analysis
- You're evaluating Blast Radius for your team

**Prerequisites:** AWS account, AWS CDK CLI, Node.js 18+, AWS CLI configured.

## Quick Start

The fastest path to seeing the UI in action:

```bash
# Terminal 1: Start the mock server
cd examples/mock-server
npm install
npm start

# Terminal 2: Start the frontend (from project root)
cd packages/frontend
VITE_API_BASE_URL=http://localhost:3001/api npm run dev
```

Then open http://localhost:5173 and navigate to an analysis.
