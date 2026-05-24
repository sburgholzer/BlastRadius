"use strict";
/**
 * Property-based tests for Adapter Registry routing.
 *
 * Feature: blast-radius-visualizer, Property 5: Adapter Registry Routes to Correct Adapter
 *
 * Validates: Requirements 2.1, 2.5
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
const handler_1 = require("./handler");
// --- Supported formats and their adapter ARNs ---
const SUPPORTED_FORMATS = {
    cloudformation: {
        arn: 'arn:aws:lambda:us-east-1:123456789012:function:cfn-adapter',
        displayName: 'CloudFormation Adapter',
    },
    'terraform-plan': {
        arn: 'arn:aws:lambda:us-east-1:123456789012:function:terraform-adapter',
        displayName: 'Terraform Adapter',
    },
    cdk: {
        arn: 'arn:aws:lambda:us-east-1:123456789012:function:cdk-adapter',
        displayName: 'CDK Adapter',
    },
    pulumi: {
        arn: 'arn:aws:lambda:us-east-1:123456789012:function:pulumi-adapter',
        displayName: 'Pulumi Adapter',
    },
};
const SUPPORTED_FORMAT_IDS = Object.keys(SUPPORTED_FORMATS);
// --- Mock helpers ---
/**
 * Creates a mock DynamoDB client that returns adapter entries for known formats
 * and returns empty results for unknown formats.
 */
function createMockDynamoClient() {
    return {
        send: vitest_1.vi.fn().mockImplementation((command) => {
            const cmd = command;
            const commandName = command.constructor.name;
            if (commandName === 'GetItemCommand') {
                const key = cmd.input.Key;
                const formatId = key.formatId.S;
                if (Object.hasOwn(SUPPORTED_FORMATS, formatId)) {
                    const entry = SUPPORTED_FORMATS[formatId];
                    return Promise.resolve({
                        Item: {
                            formatId: { S: formatId },
                            adapterLambdaArn: { S: entry.arn },
                            displayName: { S: entry.displayName },
                            version: { S: '1.0.0' },
                            registeredAt: { S: '2024-01-01T00:00:00Z' },
                        },
                    });
                }
                return Promise.resolve({ Item: undefined });
            }
            if (commandName === 'ScanCommand') {
                return Promise.resolve({
                    Items: SUPPORTED_FORMAT_IDS.map((id) => ({
                        formatId: { S: id },
                    })),
                });
            }
            return Promise.resolve({});
        }),
    };
}
/**
 * Creates a mock Lambda client that returns a valid manifest when invoked.
 */
function createMockLambdaClient() {
    return {
        send: vitest_1.vi.fn().mockImplementation((command) => {
            const cmd = command;
            const functionName = cmd.input.FunctionName;
            const manifest = {
                version: '1.0',
                metadata: {
                    submittedAt: new Date().toISOString(),
                    sourceFormat: 'canonical',
                    description: `Converted by ${functionName}`,
                },
                resources: [
                    {
                        resourceType: 'aws_instance',
                        resourceId: 'i-1234567890abcdef0',
                        provider: 'aws',
                        modificationType: 'Modify',
                    },
                ],
            };
            const responsePayload = JSON.stringify({
                manifest,
                warnings: [],
            });
            return Promise.resolve({
                Payload: new TextEncoder().encode(responsePayload),
                FunctionError: undefined,
            });
        }),
    };
}
function createMockDeps() {
    return {
        dynamoClient: createMockDynamoClient(),
        lambdaClient: createMockLambdaClient(),
    };
}
// --- Custom Arbitraries ---
/**
 * Generates a random supported format identifier from the known set.
 */
function arbitrarySupportedFormat() {
    return fc.constantFrom(...SUPPORTED_FORMAT_IDS);
}
/**
 * Generates a random unsupported format identifier (strings not in the supported set).
 */
function arbitraryUnsupportedFormat() {
    return fc
        .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), {
        minLength: 1,
        maxLength: 30,
    })
        .filter((s) => !SUPPORTED_FORMAT_IDS.includes(s));
}
/**
 * Generates a random payload object.
 */
function arbitraryPayload() {
    return fc.oneof(fc.record({
        resources: fc.array(fc.record({
            type: fc.string({ minLength: 1, maxLength: 30 }),
            id: fc.string({ minLength: 1, maxLength: 30 }),
            action: fc.constantFrom('create', 'update', 'delete'),
        }), { minLength: 1, maxLength: 10 }),
    }), fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string({ minLength: 1, maxLength: 20 })), fc.constant({ changeset: 'some-data' }));
}
// --- Property Tests ---
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 5: Adapter Registry Routes to Correct Adapter', () => {
    /**
     * **Validates: Requirements 2.1**
     *
     * For any declared source format identifier in the supported set, the Adapter
     * Registry SHALL route the changeset to the adapter registered for that format.
     */
    (0, vitest_1.it)('should route any supported format to the correct adapter ARN', async () => {
        await fc.assert(fc.asyncProperty(arbitrarySupportedFormat(), arbitraryPayload(), async (format, payload) => {
            const deps = createMockDeps();
            const result = await (0, handler_1.handler)({ format, payload }, deps);
            // Should be a successful result (has manifest and adapterMetadata)
            (0, vitest_1.expect)(result).toHaveProperty('manifest');
            (0, vitest_1.expect)(result).toHaveProperty('adapterMetadata');
            const output = result;
            (0, vitest_1.expect)(output.adapterMetadata.adapterName).toBe(SUPPORTED_FORMATS[format].displayName);
            // Verify the Lambda client was invoked with the correct adapter ARN
            const lambdaSendCalls = deps.lambdaClient.send.mock.calls;
            (0, vitest_1.expect)(lambdaSendCalls.length).toBe(1);
            const invokeCommand = lambdaSendCalls[0][0];
            (0, vitest_1.expect)(invokeCommand.input.FunctionName).toBe(SUPPORTED_FORMATS[format].arn);
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 2.5**
     *
     * For any format identifier not in the supported set, the registry SHALL
     * return an error listing all supported formats.
     */
    (0, vitest_1.it)('should return an error with supported formats list for any unsupported format', async () => {
        await fc.assert(fc.asyncProperty(arbitraryUnsupportedFormat(), arbitraryPayload(), async (format, payload) => {
            const deps = createMockDeps();
            const result = await (0, handler_1.handler)({ format, payload }, deps);
            // Should be an error result
            (0, vitest_1.expect)(result).toHaveProperty('error');
            (0, vitest_1.expect)(result).toHaveProperty('supportedFormats');
            const errorResult = result;
            (0, vitest_1.expect)(errorResult.error).toContain(format);
            (0, vitest_1.expect)(errorResult.supportedFormats).toBeDefined();
            (0, vitest_1.expect)(errorResult.supportedFormats.sort()).toEqual(SUPPORTED_FORMAT_IDS.sort());
            // Verify the Lambda client was NOT invoked
            const lambdaSendCalls = deps.lambdaClient.send.mock.calls;
            (0, vitest_1.expect)(lambdaSendCalls.length).toBe(0);
        }), { numRuns: 100 });
    });
    /**
     * Additional property: The adapter registry should never route an unsupported
     * format to any adapter Lambda.
     */
    (0, vitest_1.it)('should never invoke a Lambda for unsupported formats', async () => {
        await fc.assert(fc.asyncProperty(arbitraryUnsupportedFormat(), async (format) => {
            const deps = createMockDeps();
            await (0, handler_1.handler)({ format, payload: { data: 'test' } }, deps);
            const lambdaSendCalls = deps.lambdaClient.send.mock.calls;
            (0, vitest_1.expect)(lambdaSendCalls.length).toBe(0);
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=handler.spec.js.map