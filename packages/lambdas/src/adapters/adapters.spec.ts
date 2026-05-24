/**
 * Property-based tests for Adapter Conversion.
 *
 * Feature: blast-radius-visualizer, Property 4: Adapter Conversion Produces Valid Canonical Manifests
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 2.8
 *
 * For any supported adapter (CloudFormation, Terraform, CDK) and any valid native
 * changeset in that adapter's format, the adapter SHALL produce a ResourceChangeManifest
 * that passes canonical schema validation and preserves resource identity.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { handler as cfnHandler } from './cloudformation/handler';
import { handler as terraformHandler } from './terraform/handler';
import { handler as cdkHandler } from './cdk/handler';
import { validateManifest } from '@blast-radius/core';

// --- Valid Modification Types ---

const VALID_MODIFICATION_TYPES = ['Add', 'Modify', 'Remove', 'Replace'] as const;

// --- CloudFormation Generators ---

/**
 * Generates a valid CloudFormation resource change entry.
 */
function arbitraryCfnResourceChange() {
  return fc.record({
    Action: fc.constantFrom('Add', 'Modify', 'Remove'),
    ResourceType: fc.constantFrom(
      'AWS::EC2::Instance',
      'AWS::S3::Bucket',
      'AWS::Lambda::Function',
      'AWS::DynamoDB::Table',
      'AWS::IAM::Role',
      'AWS::RDS::DBInstance',
      'AWS::SQS::Queue',
      'AWS::SNS::Topic'
    ),
    LogicalResourceId: fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
      { minLength: 3, maxLength: 30 }
    ),
    PhysicalResourceId: fc.option(
      fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
        { minLength: 5, maxLength: 40 }
      ),
      { nil: undefined }
    ),
    Replacement: fc.option(fc.constantFrom('True', 'False', 'Conditional'), { nil: undefined }),
  });
}

/**
 * Generates a valid CloudFormation Change entry (Type: "Resource").
 */
function arbitraryCfnChange() {
  return arbitraryCfnResourceChange().map((rc) => ({
    Type: 'Resource' as const,
    ResourceChange: rc,
  }));
}

/**
 * Generates a valid CloudFormation changeset input.
 */
function arbitraryCfnChangeset() {
  return fc.record({
    ChangeSetName: fc.option(
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz-'.split('')), {
        minLength: 3,
        maxLength: 20,
      }),
      { nil: undefined }
    ),
    StackName: fc.option(
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz-'.split('')), {
        minLength: 3,
        maxLength: 20,
      }),
      { nil: undefined }
    ),
    Changes: fc.array(arbitraryCfnChange(), { minLength: 1, maxLength: 50 }),
  });
}

// --- Terraform Generators ---

/**
 * Generates valid Terraform actions (excluding no-op and read which are skipped).
 */
function arbitraryTerraformActionable(): fc.Arbitrary<string[]> {
  return fc.constantFrom(
    ['create'],
    ['update'],
    ['delete'],
    ['create', 'delete']
  );
}

/**
 * Generates a valid Terraform resource change entry with actionable actions.
 */
function arbitraryTerraformResourceChange() {
  return fc.record({
    address: fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_.'.split('')),
      { minLength: 5, maxLength: 50 }
    ),
    type: fc.constantFrom(
      'aws_instance',
      'aws_s3_bucket',
      'aws_lambda_function',
      'aws_dynamodb_table',
      'aws_iam_role',
      'aws_security_group',
      'aws_vpc',
      'aws_subnet'
    ),
    name: fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
      { minLength: 3, maxLength: 20 }
    ),
    provider_name: fc.constantFrom(
      'registry.terraform.io/hashicorp/aws',
      'registry.terraform.io/hashicorp/azurerm',
      'registry.terraform.io/hashicorp/google'
    ),
    change: fc.record({
      actions: arbitraryTerraformActionable(),
      before: fc.option(fc.constant({ key: 'value' }), { nil: null }),
      after: fc.option(fc.constant({ key: 'new_value' }), { nil: null }),
    }),
  });
}

/**
 * Generates Terraform resource changes that include no-op/read actions (to be skipped).
 */
function arbitraryTerraformResourceChangeWithSkippable() {
  return fc.oneof(
    { weight: 4, arbitrary: arbitraryTerraformResourceChange() },
    {
      weight: 1,
      arbitrary: fc.record({
        address: fc.stringOf(
          fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_.'.split('')),
          { minLength: 5, maxLength: 50 }
        ),
        type: fc.constantFrom('aws_instance', 'aws_s3_bucket', 'aws_lambda_function'),
        name: fc.stringOf(
          fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
          { minLength: 3, maxLength: 20 }
        ),
        provider_name: fc.constant('registry.terraform.io/hashicorp/aws'),
        change: fc.record({
          actions: fc.constantFrom(['no-op'], ['read']),
          before: fc.constant(null),
          after: fc.constant(null),
        }),
      }),
    }
  );
}

/**
 * Generates a valid Terraform plan JSON input.
 */
function arbitraryTerraformPlan() {
  return fc.record({
    format_version: fc.constantFrom('1.0', '1.1', '1.2'),
    terraform_version: fc.constantFrom('1.5.0', '1.6.0', '1.7.0', '1.8.0'),
    resource_changes: fc.array(arbitraryTerraformResourceChangeWithSkippable(), {
      minLength: 1,
      maxLength: 50,
    }),
  });
}

// --- CDK Generators ---

/**
 * Generates a valid CDK resource entry.
 */
function arbitraryCdkResourceEntry() {
  return fc.record({
    changeType: fc.constantFrom('CREATE', 'UPDATE', 'DELETE', 'REPLACE'),
    logicalId: fc.option(
      fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
        { minLength: 3, maxLength: 30 }
      ),
      { nil: undefined }
    ),
    physicalId: fc.option(
      fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
        { minLength: 5, maxLength: 40 }
      ),
      { nil: undefined }
    ),
  });
}

/**
 * Generates a CDK resource type group: a map of logicalId -> resource entry.
 */
function arbitraryCdkResourceTypeGroup() {
  return fc.array(
    fc.tuple(
      fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
        { minLength: 3, maxLength: 20 }
      ),
      arbitraryCdkResourceEntry()
    ),
    { minLength: 1, maxLength: 5 }
  ).map((entries) => {
    const group: Record<string, unknown> = {};
    for (const [id, entry] of entries) {
      group[id] = entry;
    }
    return group;
  });
}

/**
 * Generates a CDK resources section: a map of resourceType -> resource type group.
 */
function arbitraryCdkResources() {
  const resourceTypes = [
    'AWS::S3::Bucket',
    'AWS::Lambda::Function',
    'AWS::DynamoDB::Table',
    'AWS::IAM::Role',
    'AWS::EC2::Instance',
    'AWS::SQS::Queue',
  ];

  return fc
    .subarray(resourceTypes, { minLength: 1, maxLength: 4 })
    .chain((types) =>
      fc.tuple(...types.map(() => arbitraryCdkResourceTypeGroup())).map((groups) => {
        const resources: Record<string, unknown> = {};
        types.forEach((type, i) => {
          resources[type] = groups[i];
        });
        return resources;
      })
    );
}

/**
 * Generates a valid CDK cloud assembly diff input.
 */
function arbitraryCdkDiff() {
  return fc.record({
    stackName: fc.option(
      fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz-'.split('')), {
        minLength: 3,
        maxLength: 20,
      }),
      { nil: undefined }
    ),
    resources: arbitraryCdkResources(),
  });
}

// --- Helper Functions ---

/**
 * Counts the expected number of resources from a Terraform plan,
 * excluding no-op and read actions.
 */
function countActionableResources(plan: { resource_changes: Array<{ change: { actions: string[] } }> }): number {
  return plan.resource_changes.filter((rc) => {
    const actions = rc.change.actions;
    if (actions.length === 1 && (actions[0] === 'no-op' || actions[0] === 'read')) {
      return false;
    }
    return true;
  }).length;
}

/**
 * Counts the total number of resource entries in a CDK resources section.
 */
function countCdkResources(resources: Record<string, unknown>): number {
  let count = 0;
  for (const resourceType of Object.keys(resources)) {
    const group = resources[resourceType] as Record<string, unknown>;
    count += Object.keys(group).length;
  }
  return count;
}

// --- Property Tests ---

describe('Feature: blast-radius-visualizer, Property 4: Adapter Conversion Produces Valid Canonical Manifests', () => {
  /**
   * **Validates: Requirements 2.2**
   *
   * CloudFormation adapter: For any valid CloudFormation changeset input,
   * the adapter produces a valid ResourceChangeManifest that passes schema validation.
   */
  describe('CloudFormation Adapter', () => {
    it('should produce a valid manifest for any valid CloudFormation changeset', () => {
      fc.assert(
        fc.property(arbitraryCfnChangeset(), (changeset) => {
          const result = cfnHandler(changeset);

          // Output has `manifest` property (not `error`)
          expect(result).toHaveProperty('manifest');
          expect(result).not.toHaveProperty('error');

          const output = result as { manifest: unknown; warnings: string[] };

          // Validate against canonical schema
          const validation = validateManifest(output.manifest);
          expect(validation.success).toBe(true);

          // Resource count matches input Changes array length
          const manifest = output.manifest as { resources: unknown[] };
          expect(manifest.resources.length).toBe(changeset.Changes.length);

          // Each resource has required fields and valid modificationType
          for (const resource of manifest.resources as Array<{
            resourceType: string;
            resourceId: string;
            provider: string;
            modificationType: string;
          }>) {
            expect(resource.resourceType).toBeTruthy();
            expect(resource.resourceId).toBeTruthy();
            expect(resource.provider).toBeTruthy();
            expect(VALID_MODIFICATION_TYPES).toContain(resource.modificationType);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly map CloudFormation actions to modification types', () => {
      fc.assert(
        fc.property(arbitraryCfnChangeset(), (changeset) => {
          const result = cfnHandler(changeset);
          expect(result).toHaveProperty('manifest');

          const output = result as { manifest: { resources: Array<{ modificationType: string }> } };

          for (let i = 0; i < changeset.Changes.length; i++) {
            const action = changeset.Changes[i].ResourceChange.Action;
            const replacement = changeset.Changes[i].ResourceChange.Replacement;
            const modificationType = output.manifest.resources[i].modificationType;

            switch (action) {
              case 'Add':
                expect(modificationType).toBe('Add');
                break;
              case 'Remove':
                expect(modificationType).toBe('Remove');
                break;
              case 'Modify':
                if (replacement === 'True') {
                  expect(modificationType).toBe('Replace');
                } else {
                  expect(modificationType).toBe('Modify');
                }
                break;
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * Terraform adapter: For any valid Terraform plan JSON input,
   * the adapter produces a valid ResourceChangeManifest that passes schema validation.
   */
  describe('Terraform Adapter', () => {
    it('should produce a valid manifest for any valid Terraform plan', () => {
      fc.assert(
        fc.property(arbitraryTerraformPlan(), (plan) => {
          const result = terraformHandler(plan);

          // Output has `manifest` property (not `error`)
          expect(result).toHaveProperty('manifest');
          expect(result).not.toHaveProperty('error');

          const output = result as { manifest: unknown; warnings: string[] };

          // Validate against canonical schema
          const validation = validateManifest(output.manifest);
          expect(validation.success).toBe(true);

          // Resource count matches expected (excluding no-op/read)
          const manifest = output.manifest as { resources: unknown[] };
          const expectedCount = countActionableResources(plan);
          expect(manifest.resources.length).toBe(expectedCount);

          // Each resource has required fields and valid modificationType
          for (const resource of manifest.resources as Array<{
            resourceType: string;
            resourceId: string;
            provider: string;
            modificationType: string;
          }>) {
            expect(resource.resourceType).toBeTruthy();
            expect(resource.resourceId).toBeTruthy();
            expect(resource.provider).toBeTruthy();
            expect(VALID_MODIFICATION_TYPES).toContain(resource.modificationType);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly map Terraform actions to modification types', () => {
      fc.assert(
        fc.property(arbitraryTerraformPlan(), (plan) => {
          const result = terraformHandler(plan);
          expect(result).toHaveProperty('manifest');

          const output = result as { manifest: { resources: Array<{ modificationType: string; resourceId: string }> } };

          // Build a map of address -> expected modification type for actionable resources
          const expectedMappings: Array<{ address: string; expectedType: string }> = [];
          for (const rc of plan.resource_changes) {
            const actions = rc.change.actions;
            if (actions.length === 1) {
              switch (actions[0]) {
                case 'create':
                  expectedMappings.push({ address: rc.address, expectedType: 'Add' });
                  break;
                case 'update':
                  expectedMappings.push({ address: rc.address, expectedType: 'Modify' });
                  break;
                case 'delete':
                  expectedMappings.push({ address: rc.address, expectedType: 'Remove' });
                  break;
                // no-op and read are skipped
              }
            } else if (actions.length === 2) {
              const sorted = [...actions].sort();
              if (sorted[0] === 'create' && sorted[1] === 'delete') {
                expectedMappings.push({ address: rc.address, expectedType: 'Replace' });
              }
            }
          }

          // Verify each output resource matches expected mapping
          expect(output.manifest.resources.length).toBe(expectedMappings.length);
          for (let i = 0; i < expectedMappings.length; i++) {
            expect(output.manifest.resources[i].resourceId).toBe(expectedMappings[i].address);
            expect(output.manifest.resources[i].modificationType).toBe(expectedMappings[i].expectedType);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * CDK adapter: For any valid CDK cloud assembly diff input,
   * the adapter produces a valid ResourceChangeManifest that passes schema validation.
   */
  describe('CDK Adapter', () => {
    it('should produce a valid manifest for any valid CDK cloud assembly diff', () => {
      fc.assert(
        fc.property(arbitraryCdkDiff(), (diff) => {
          const result = cdkHandler(diff);

          // Output has `manifest` property (not `error`)
          expect(result).toHaveProperty('manifest');
          expect(result).not.toHaveProperty('error');

          const output = result as { manifest: unknown; warnings: string[] };

          // Validate against canonical schema
          const validation = validateManifest(output.manifest);
          expect(validation.success).toBe(true);

          // Resource count matches expected
          const manifest = output.manifest as { resources: unknown[] };
          const expectedCount = countCdkResources(diff.resources);
          expect(manifest.resources.length).toBe(expectedCount);

          // Each resource has required fields and valid modificationType
          for (const resource of manifest.resources as Array<{
            resourceType: string;
            resourceId: string;
            provider: string;
            modificationType: string;
          }>) {
            expect(resource.resourceType).toBeTruthy();
            expect(resource.resourceId).toBeTruthy();
            expect(resource.provider).toBeTruthy();
            expect(VALID_MODIFICATION_TYPES).toContain(resource.modificationType);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly map CDK changeTypes to modification types', () => {
      fc.assert(
        fc.property(arbitraryCdkDiff(), (diff) => {
          const result = cdkHandler(diff);
          expect(result).toHaveProperty('manifest');

          const output = result as { manifest: { resources: Array<{ modificationType: string; resourceType: string }> } };

          // Collect expected mappings from the diff
          const expectedTypes: string[] = [];
          for (const resourceType of Object.keys(diff.resources)) {
            const group = diff.resources[resourceType] as Record<string, { changeType: string }>;
            for (const logicalId of Object.keys(group)) {
              const changeType = group[logicalId].changeType.toUpperCase();
              switch (changeType) {
                case 'CREATE':
                  expectedTypes.push('Add');
                  break;
                case 'UPDATE':
                  expectedTypes.push('Modify');
                  break;
                case 'DELETE':
                  expectedTypes.push('Remove');
                  break;
                case 'REPLACE':
                  expectedTypes.push('Replace');
                  break;
                default:
                  expectedTypes.push('Modify');
              }
            }
          }

          // Verify modification types match
          expect(output.manifest.resources.length).toBe(expectedTypes.length);
          for (let i = 0; i < expectedTypes.length; i++) {
            expect(output.manifest.resources[i].modificationType).toBe(expectedTypes[i]);
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
