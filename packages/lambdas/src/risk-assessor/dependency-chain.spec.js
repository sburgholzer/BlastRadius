"use strict";
/**
 * Property-based tests for critical resource dependency chains.
 *
 * Feature: blast-radius-visualizer, Property 11: Critical Resources Include Dependency Chain
 *
 * **Validates: Requirements 4.4**
 *
 * For any resource classified as Critical (score 75-100), the Risk Assessor output
 * SHALL include a valid dependency chain — an ordered list of resource identifiers
 * from the changed resource to the affected resource, where each consecutive pair
 * has a direct dependency edge.
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
// --- Generators ---
/**
 * Generates a graph scenario that produces a Critical resource:
 * - A directly changed source resource with modification type Remove (severity 100)
 * - A target resource of type AWS::RDS::DBInstance (criticality Critical = 100) at depth 1
 *
 * With depth 1, Remove, and Critical criticality:
 *   depthScore = max(10, 100 - ((1-1)*10)) = 100
 *   criticalityScore = 100
 *   changeTypeSeverity = 100
 *   Impact_Score = round((100*0.30) + (100*0.40) + (100*0.30)) = 100 → Critical
 *
 * Additional intermediate nodes may be added to make the graph more realistic,
 * but the target is always at depth 1 from the source.
 */
const arbitraryCriticalResourceGraph = fc
    .record({
    sourceId: fc.string({ minLength: 3, maxLength: 12 }).map((s) => `src-${s.replace(/[^a-zA-Z0-9]/g, 'x')}`),
    targetId: fc.string({ minLength: 3, maxLength: 12 }).map((s) => `tgt-${s.replace(/[^a-zA-Z0-9]/g, 'x')}`),
    extraNodeCount: fc.integer({ min: 0, max: 3 }),
    sourceResourceType: fc.constantFrom('AWS::EC2::Instance', 'AWS::Lambda::Function', 'AWS::S3::Bucket', 'AWS::SNS::Topic'),
})
    .filter(({ sourceId, targetId }) => sourceId !== targetId)
    .map(({ sourceId, targetId, extraNodeCount, sourceResourceType }) => {
    const nodes = [];
    const edges = [];
    // Source node (directly changed)
    nodes.push({
        resourceId: sourceId,
        resourceType: sourceResourceType,
        provider: 'aws',
        region: 'us-east-1',
        accountId: '123456789012',
        isDirectChange: true,
        dependencyCoverage: 'full',
    });
    // Target node (AWS::RDS::DBInstance → Critical criticality)
    nodes.push({
        resourceId: targetId,
        resourceType: 'AWS::RDS::DBInstance',
        provider: 'aws',
        region: 'us-east-1',
        accountId: '123456789012',
        isDirectChange: false,
        dependencyCoverage: 'full',
    });
    // Direct edge from source to target at depth 1
    edges.push({
        sourceId: sourceId,
        targetId: targetId,
        relationshipType: 'references',
        depth: 1,
    });
    // Add extra unrelated nodes to make the graph more realistic
    for (let i = 0; i < extraNodeCount; i++) {
        const extraId = `extra-${i}-${sourceId}`;
        nodes.push({
            resourceId: extraId,
            resourceType: 'AWS::CloudWatch::Alarm',
            provider: 'aws',
            region: 'us-east-1',
            accountId: '123456789012',
            isDirectChange: false,
            dependencyCoverage: 'full',
        });
        edges.push({
            sourceId: sourceId,
            targetId: extraId,
            relationshipType: 'references',
            depth: 1,
        });
    }
    const manifest = {
        version: '1.0',
        metadata: {
            submittedAt: new Date().toISOString(),
            sourceFormat: 'canonical',
        },
        resources: [
            {
                resourceId: sourceId,
                resourceType: sourceResourceType,
                provider: 'aws',
                modificationType: 'Remove',
                region: 'us-east-1',
                accountId: '123456789012',
            },
        ],
    };
    const dependencyGraph = { nodes, edges };
    return { sourceId, targetId, dependencyGraph, manifest };
});
// --- Property Tests ---
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 11: Critical Resources Include Dependency Chain', () => {
    /**
     * **Validates: Requirements 4.4**
     *
     * For any resource classified as Critical, the dependencyChain must be non-empty.
     */
    (0, vitest_1.it)('should include a non-empty dependencyChain for Critical resources', async () => {
        await fc.assert(fc.asyncProperty(arbitraryCriticalResourceGraph, async ({ sourceId, targetId, dependencyGraph, manifest }) => {
            const input = { dependencyGraph, manifest };
            const result = await (0, handler_1.handler)(input);
            const targetScored = result.scoredResources.find((r) => r.resourceId === targetId);
            (0, vitest_1.expect)(targetScored).toBeDefined();
            (0, vitest_1.expect)(targetScored.riskCategory).toBe('Critical');
            (0, vitest_1.expect)(targetScored.dependencyChain).toBeDefined();
            (0, vitest_1.expect)(targetScored.dependencyChain.length).toBeGreaterThan(0);
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 4.4**
     *
     * The first element of the dependency chain must be the directly changed resource.
     */
    (0, vitest_1.it)('should have the direct change as the first element of the dependency chain', async () => {
        await fc.assert(fc.asyncProperty(arbitraryCriticalResourceGraph, async ({ sourceId, targetId, dependencyGraph, manifest }) => {
            const input = { dependencyGraph, manifest };
            const result = await (0, handler_1.handler)(input);
            const targetScored = result.scoredResources.find((r) => r.resourceId === targetId);
            (0, vitest_1.expect)(targetScored).toBeDefined();
            (0, vitest_1.expect)(targetScored.riskCategory).toBe('Critical');
            (0, vitest_1.expect)(targetScored.dependencyChain[0]).toBe(sourceId);
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 4.4**
     *
     * The last element of the dependency chain must be the scored (affected) resource.
     */
    (0, vitest_1.it)('should have the scored resource as the last element of the dependency chain', async () => {
        await fc.assert(fc.asyncProperty(arbitraryCriticalResourceGraph, async ({ sourceId, targetId, dependencyGraph, manifest }) => {
            const input = { dependencyGraph, manifest };
            const result = await (0, handler_1.handler)(input);
            const targetScored = result.scoredResources.find((r) => r.resourceId === targetId);
            (0, vitest_1.expect)(targetScored).toBeDefined();
            (0, vitest_1.expect)(targetScored.riskCategory).toBe('Critical');
            const chain = targetScored.dependencyChain;
            (0, vitest_1.expect)(chain[chain.length - 1]).toBe(targetId);
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 4.4**
     *
     * Each consecutive pair in the dependency chain must have a direct dependency edge
     * in the graph.
     */
    (0, vitest_1.it)('should have a valid edge between each consecutive pair in the dependency chain', async () => {
        await fc.assert(fc.asyncProperty(arbitraryCriticalResourceGraph, async ({ sourceId, targetId, dependencyGraph, manifest }) => {
            const input = { dependencyGraph, manifest };
            const result = await (0, handler_1.handler)(input);
            const targetScored = result.scoredResources.find((r) => r.resourceId === targetId);
            (0, vitest_1.expect)(targetScored).toBeDefined();
            (0, vitest_1.expect)(targetScored.riskCategory).toBe('Critical');
            const chain = targetScored.dependencyChain;
            // Each consecutive pair must have a corresponding edge in the graph
            for (let i = 0; i < chain.length - 1; i++) {
                const from = chain[i];
                const to = chain[i + 1];
                const hasEdge = dependencyGraph.edges.some((e) => e.sourceId === from && e.targetId === to);
                (0, vitest_1.expect)(hasEdge).toBe(true);
            }
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=dependency-chain.spec.js.map