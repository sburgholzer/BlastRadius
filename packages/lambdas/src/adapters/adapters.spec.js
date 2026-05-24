"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fc = __importStar(require("fast-check"));
const handler_1 = require("./cloudformation/handler");
const handler_2 = require("./terraform/handler");
const handler_3 = require("./cdk/handler");
const core_1 = require("@blast-radius/core");
// --- Valid Modification Types ---
const VALID_MODIFICATION_TYPES = ['Add', 'Modify', 'Remove', 'Replace'];
// --- CloudFormation Generators ---
/**
 * Generates a valid CloudFormation resource change entry.
 */
function arbitraryCfnResourceChange() {
    return fc.record({
        Action: fc.constantFrom('Add', 'Modify', 'Remove'),
        ResourceType: fc.constantFrom('AWS::EC2::Instance', 'AWS::S3::Bucket', 'AWS::Lambda::Function', 'AWS::DynamoDB::Table', 'AWS::IAM::Role', 'AWS::RDS::DBInstance', 'AWS::SQS::Queue', 'AWS::SNS::Topic'),
        LogicalResourceId: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), { minLength: 3, maxLength: 30 }),
        PhysicalResourceId: fc.option(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), { minLength: 5, maxLength: 40 }), { nil: undefined }),
        Replacement: fc.option(fc.constantFrom('True', 'False', 'Conditional'), { nil: undefined }),
    });
}
/**
 * Generates a valid CloudFormation Change entry (Type: "Resource").
 */
function arbitraryCfnChange() {
    return arbitraryCfnResourceChange().map((rc) => ({
        Type: 'Resource',
        ResourceChange: rc,
    }));
}
/**
 * Generates a valid CloudFormation changeset input.
 */
function arbitraryCfnChangeset() {
    return fc.record({
        ChangeSetName: fc.option(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz-'.split('')), {
            minLength: 3,
            maxLength: 20,
        }), { nil: undefined }),
        StackName: fc.option(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz-'.split('')), {
            minLength: 3,
            maxLength: 20,
        }), { nil: undefined }),
        Changes: fc.array(arbitraryCfnChange(), { minLength: 1, maxLength: 50 }),
    });
}
// --- Terraform Generators ---
/**
 * Generates valid Terraform actions (excluding no-op and read which are skipped).
 */
function arbitraryTerraformActionable() {
    return fc.constantFrom(['create'], ['update'], ['delete'], ['create', 'delete']);
}
/**
 * Generates a valid Terraform resource change entry with actionable actions.
 */
function arbitraryTerraformResourceChange() {
    return fc.record({
        address: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_.'.split('')), { minLength: 5, maxLength: 50 }),
        type: fc.constantFrom('aws_instance', 'aws_s3_bucket', 'aws_lambda_function', 'aws_dynamodb_table', 'aws_iam_role', 'aws_security_group', 'aws_vpc', 'aws_subnet'),
        name: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')), { minLength: 3, maxLength: 20 }),
        provider_name: fc.constantFrom('registry.terraform.io/hashicorp/aws', 'registry.terraform.io/hashicorp/azurerm', 'registry.terraform.io/hashicorp/google'),
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
    return fc.oneof({ weight: 4, arbitrary: arbitraryTerraformResourceChange() }, {
        weight: 1,
        arbitrary: fc.record({
            address: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_.'.split('')), { minLength: 5, maxLength: 50 }),
            type: fc.constantFrom('aws_instance', 'aws_s3_bucket', 'aws_lambda_function'),
            name: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')), { minLength: 3, maxLength: 20 }),
            provider_name: fc.constant('registry.terraform.io/hashicorp/aws'),
            change: fc.record({
                actions: fc.constantFrom(['no-op'], ['read']),
                before: fc.constant(null),
                after: fc.constant(null),
            }),
        }),
    });
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
        logicalId: fc.option(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), { minLength: 3, maxLength: 30 }), { nil: undefined }),
        physicalId: fc.option(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), { minLength: 5, maxLength: 40 }), { nil: undefined }),
    });
}
/**
 * Generates a CDK resource type group: a map of logicalId -> resource entry.
 */
function arbitraryCdkResourceTypeGroup() {
    return fc.array(fc.tuple(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), { minLength: 3, maxLength: 20 }), arbitraryCdkResourceEntry()), { minLength: 1, maxLength: 5 }).map((entries) => {
        const group = {};
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
        .chain((types) => fc.tuple(...types.map(() => arbitraryCdkResourceTypeGroup())).map((groups) => {
        const resources = {};
        types.forEach((type, i) => {
            resources[type] = groups[i];
        });
        return resources;
    }));
}
/**
 * Generates a valid CDK cloud assembly diff input.
 */
function arbitraryCdkDiff() {
    return fc.record({
        stackName: fc.option(fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz-'.split('')), {
            minLength: 3,
            maxLength: 20,
        }), { nil: undefined }),
        resources: arbitraryCdkResources(),
    });
}
// --- Helper Functions ---
/**
 * Counts the expected number of resources from a Terraform plan,
 * excluding no-op and read actions.
 */
function countActionableResources(plan) {
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
function countCdkResources(resources) {
    let count = 0;
    for (const resourceType of Object.keys(resources)) {
        const group = resources[resourceType];
        count += Object.keys(group).length;
    }
    return count;
}
// --- Property Tests ---
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 4: Adapter Conversion Produces Valid Canonical Manifests', () => {
    /**
     * **Validates: Requirements 2.2**
     *
     * CloudFormation adapter: For any valid CloudFormation changeset input,
     * the adapter produces a valid ResourceChangeManifest that passes schema validation.
     */
    (0, vitest_1.describe)('CloudFormation Adapter', () => {
        (0, vitest_1.it)('should produce a valid manifest for any valid CloudFormation changeset', () => {
            fc.assert(fc.property(arbitraryCfnChangeset(), (changeset) => {
                const result = (0, handler_1.handler)(changeset);
                // Output has `manifest` property (not `error`)
                (0, vitest_1.expect)(result).toHaveProperty('manifest');
                (0, vitest_1.expect)(result).not.toHaveProperty('error');
                const output = result;
                // Validate against canonical schema
                const validation = (0, core_1.validateManifest)(output.manifest);
                (0, vitest_1.expect)(validation.success).toBe(true);
                // Resource count matches input Changes array length
                const manifest = output.manifest;
                (0, vitest_1.expect)(manifest.resources.length).toBe(changeset.Changes.length);
                // Each resource has required fields and valid modificationType
                for (const resource of manifest.resources) {
                    (0, vitest_1.expect)(resource.resourceType).toBeTruthy();
                    (0, vitest_1.expect)(resource.resourceId).toBeTruthy();
                    (0, vitest_1.expect)(resource.provider).toBeTruthy();
                    (0, vitest_1.expect)(VALID_MODIFICATION_TYPES).toContain(resource.modificationType);
                }
            }), { numRuns: 100 });
        });
        (0, vitest_1.it)('should correctly map CloudFormation actions to modification types', () => {
            fc.assert(fc.property(arbitraryCfnChangeset(), (changeset) => {
                const result = (0, handler_1.handler)(changeset);
                (0, vitest_1.expect)(result).toHaveProperty('manifest');
                const output = result;
                for (let i = 0; i < changeset.Changes.length; i++) {
                    const action = changeset.Changes[i].ResourceChange.Action;
                    const replacement = changeset.Changes[i].ResourceChange.Replacement;
                    const modificationType = output.manifest.resources[i].modificationType;
                    switch (action) {
                        case 'Add':
                            (0, vitest_1.expect)(modificationType).toBe('Add');
                            break;
                        case 'Remove':
                            (0, vitest_1.expect)(modificationType).toBe('Remove');
                            break;
                        case 'Modify':
                            if (replacement === 'True') {
                                (0, vitest_1.expect)(modificationType).toBe('Replace');
                            }
                            else {
                                (0, vitest_1.expect)(modificationType).toBe('Modify');
                            }
                            break;
                    }
                }
            }), { numRuns: 100 });
        });
    });
    /**
     * **Validates: Requirements 2.3**
     *
     * Terraform adapter: For any valid Terraform plan JSON input,
     * the adapter produces a valid ResourceChangeManifest that passes schema validation.
     */
    (0, vitest_1.describe)('Terraform Adapter', () => {
        (0, vitest_1.it)('should produce a valid manifest for any valid Terraform plan', () => {
            fc.assert(fc.property(arbitraryTerraformPlan(), (plan) => {
                const result = (0, handler_2.handler)(plan);
                // Output has `manifest` property (not `error`)
                (0, vitest_1.expect)(result).toHaveProperty('manifest');
                (0, vitest_1.expect)(result).not.toHaveProperty('error');
                const output = result;
                // Validate against canonical schema
                const validation = (0, core_1.validateManifest)(output.manifest);
                (0, vitest_1.expect)(validation.success).toBe(true);
                // Resource count matches expected (excluding no-op/read)
                const manifest = output.manifest;
                const expectedCount = countActionableResources(plan);
                (0, vitest_1.expect)(manifest.resources.length).toBe(expectedCount);
                // Each resource has required fields and valid modificationType
                for (const resource of manifest.resources) {
                    (0, vitest_1.expect)(resource.resourceType).toBeTruthy();
                    (0, vitest_1.expect)(resource.resourceId).toBeTruthy();
                    (0, vitest_1.expect)(resource.provider).toBeTruthy();
                    (0, vitest_1.expect)(VALID_MODIFICATION_TYPES).toContain(resource.modificationType);
                }
            }), { numRuns: 100 });
        });
        (0, vitest_1.it)('should correctly map Terraform actions to modification types', () => {
            fc.assert(fc.property(arbitraryTerraformPlan(), (plan) => {
                const result = (0, handler_2.handler)(plan);
                (0, vitest_1.expect)(result).toHaveProperty('manifest');
                const output = result;
                // Build a map of address -> expected modification type for actionable resources
                const expectedMappings = [];
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
                    }
                    else if (actions.length === 2) {
                        const sorted = [...actions].sort();
                        if (sorted[0] === 'create' && sorted[1] === 'delete') {
                            expectedMappings.push({ address: rc.address, expectedType: 'Replace' });
                        }
                    }
                }
                // Verify each output resource matches expected mapping
                (0, vitest_1.expect)(output.manifest.resources.length).toBe(expectedMappings.length);
                for (let i = 0; i < expectedMappings.length; i++) {
                    (0, vitest_1.expect)(output.manifest.resources[i].resourceId).toBe(expectedMappings[i].address);
                    (0, vitest_1.expect)(output.manifest.resources[i].modificationType).toBe(expectedMappings[i].expectedType);
                }
            }), { numRuns: 100 });
        });
    });
    /**
     * **Validates: Requirements 2.4**
     *
     * CDK adapter: For any valid CDK cloud assembly diff input,
     * the adapter produces a valid ResourceChangeManifest that passes schema validation.
     */
    (0, vitest_1.describe)('CDK Adapter', () => {
        (0, vitest_1.it)('should produce a valid manifest for any valid CDK cloud assembly diff', () => {
            fc.assert(fc.property(arbitraryCdkDiff(), (diff) => {
                const result = (0, handler_3.handler)(diff);
                // Output has `manifest` property (not `error`)
                (0, vitest_1.expect)(result).toHaveProperty('manifest');
                (0, vitest_1.expect)(result).not.toHaveProperty('error');
                const output = result;
                // Validate against canonical schema
                const validation = (0, core_1.validateManifest)(output.manifest);
                (0, vitest_1.expect)(validation.success).toBe(true);
                // Resource count matches expected
                const manifest = output.manifest;
                const expectedCount = countCdkResources(diff.resources);
                (0, vitest_1.expect)(manifest.resources.length).toBe(expectedCount);
                // Each resource has required fields and valid modificationType
                for (const resource of manifest.resources) {
                    (0, vitest_1.expect)(resource.resourceType).toBeTruthy();
                    (0, vitest_1.expect)(resource.resourceId).toBeTruthy();
                    (0, vitest_1.expect)(resource.provider).toBeTruthy();
                    (0, vitest_1.expect)(VALID_MODIFICATION_TYPES).toContain(resource.modificationType);
                }
            }), { numRuns: 100 });
        });
        (0, vitest_1.it)('should correctly map CDK changeTypes to modification types', () => {
            fc.assert(fc.property(arbitraryCdkDiff(), (diff) => {
                const result = (0, handler_3.handler)(diff);
                (0, vitest_1.expect)(result).toHaveProperty('manifest');
                const output = result;
                // Collect expected mappings from the diff
                const expectedTypes = [];
                for (const resourceType of Object.keys(diff.resources)) {
                    const group = diff.resources[resourceType];
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
                (0, vitest_1.expect)(output.manifest.resources.length).toBe(expectedTypes.length);
                for (let i = 0; i < expectedTypes.length; i++) {
                    (0, vitest_1.expect)(output.manifest.resources[i].modificationType).toBe(expectedTypes[i]);
                }
            }), { numRuns: 100 });
        });
    });
});
//# sourceMappingURL=adapters.spec.js.map