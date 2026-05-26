#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BlastRadiusStack } from '../src/stacks/blast-radius-stack.js';

const app = new cdk.App();

new BlastRadiusStack(app, 'BlastRadiusStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  enableBedrockSummary: true,
  resultsRetentionDays: 90,
});
