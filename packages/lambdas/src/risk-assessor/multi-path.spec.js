"use strict";
/**
 * Property-based tests for multi-path scoring.
 *
 * Feature: blast-radius-visualizer, Property 10: Multi-Path Scoring Uses Maximum
 *
 * Validates: Requirements 4.6
 *
 * For any resource reachable via multiple dependency paths from changed resources,
 * the Risk Assessor SHALL assign the Impact_Score corresponding to the highest-scoring path.
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
const core_1 = require("@blast-radius/core");
// --- Constants ---
const CRITICALITY_SCORES = {
    Critical: 100,
    High: 75,
    Medium: 50,
    Low: 25,
};
const CHANGE_TYPE_SEVERITY = {
    Remove: 100,
    Replace: 80,
    Modify: 50,
    Add: 30,
};
// Resource types mapped to known criticality levels for deterministic testing
const RESOURCE_TYPES_BY_CRITICALITY = {
    Critical: 'AWS::RDS::DBInstance',
    High: 'AWS::Lambda::Function',
    Medium: 'AWS::S3::Bucket',
    Low: 'AWS::CloudWatch::Alarm',
};
// --- Generators ---
/** Generates a modification type. */
const arbitraryModificationType = fc.constantFrom('Remove', 'Replace', 'Modify', 'Add');
/** Generates a criticality classification. */
const arbitraryCriticality = fc.constantFrom('Critical', 'High', 'Medium', 'Low');
/** Generates a depth between 1 and 9 (to allow room for multi-hop paths). */
const arbitraryDepth = fc.integer({ min: 1, max: 5 });
/**
 * Generates a multi-path graph scenario where a target resource is reachable
 * from multiple source (directly changed) resources via different paths.
 *
 * Structure:
 * - 2-4 source resources (directly changed) with different modification types
 * - 1 target resource reachable from all sources at different depths
 * - Intermediate nodes connecting sources to target
 */
const arbitraryMultiPathScenario = fc.record({
    numSources: fc.integer({ min: 2, max: 4 }),
    sourceModTypes: fc.array(arbitraryModificationType, { minLength: 4, maxLength: 4 }),
    pathDepths: fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 4, maxLength: 4 }),
    targetCriticality: arbitraryCriticality,
}).map(({ numSources, sourceModTypes, pathDepths, targetCriticality }) => {
    const targetId = 'target-resource';
    const targetResourceType = RESOURCE_TYPES_BY_CRITICALITY[targetCriticality];
    const nodes = [];
    const edges = [];
    const manifestResources = [];
    // Create target node
    nodes.push({
        resourceId: targetId,
        resourceType: targetResourceType,
        provider: 'aws',
        region: 'us-east-1',
        accountId: '123456789012',
        isDirectChange: false,
        dependencyCoverage: 'full',
    });
    // Create source nodes and paths to target
    for (let i = 0; i < numSources; i++) {
        const sourceId = `source-${i}`;
        const modType = sourceModTypes[i];
        const depth = pathDepths[i];
        // Add source node
        nodes.push({
            resourceId: sourceId,
            resourceType: 'AWS::EC2::Instance',
            provider: 'aws',
            region: 'us-east-1',
            accountId: '123456789012',
            isDirectChange: true,
            dependencyCoverage: 'full',
        });
        // Add manifest resource
        manifestResources.push({
            resourceId: sourceId,
            resourceType: 'AWS::EC2::Instance',
            provider: 'aws',
            modificationType: modType,
            region: 'us-east-1',
            accountId: '123456789012',
        });
        // Create intermediate nodes and edges for this path
        let prevNodeId = sourceId;
        for (let d = 1; d < depth; d++) {
            const intermediateId = `intermediate-${i}-${d}`;
            nodes.push({
                resourceId: intermediateId,
                resourceType: 'AWS::SNS::Topic',
                provider: 'aws',
                region: 'us-east-1',
                accountId: '123456789012',
                isDirectChange: false,
                dependencyCoverage: 'full',
            });
            edges.push({
                sourceId: prevNodeId,
                targetId: intermediateId,
                relationshipType: 'references',
                depth: d,
            });
            prevNodeId = intermediateId;
        }
        // Final edge to target
        edges.push({
            sourceId: prevNodeId,
            targetId: targetId,
            relationshipType: 'references',
            depth: depth,
        });
    }
    return {
        numSources,
        sourceModTypes: sourceModTypes.slice(0, numSources),
        pathDepths: pathDepths.slice(0, numSources),
        targetCriticality,
        targetId,
        targetResourceType,
        nodes,
        edges,
        manifestResources,
    };
});
// --- Helper Functions ---
/**
 * Manually compute the expected maximum score across all paths to the target.
 */
function computeExpectedMaxScore(numSources, sourceModTypes, pathDepths, targetCriticality) {
    const criticalityScore = CRITICALITY_SCORES[targetCriticality];
    let maxScore = -1;
    for (let i = 0; i < numSources; i++) {
        const depth = pathDepths[i];
        const depthScore = (0, handler_1.computeDepthScore)(depth);
        const changeTypeSev = CHANGE_TYPE_SEVERITY[sourceModTypes[i]];
        const score = (0, handler_1.computeImpactScore)(depthScore, criticalityScore, changeTypeSev);
        if (score > maxScore) {
            maxScore = score;
        }
    }
    return maxScore;
}
// --- Property Tests ---
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 10: Multi-Path Scoring Uses Maximum', () => {
    /**
     * **Validates: Requirements 4.6**
     *
     * For any resource reachable via multiple dependency paths from changed resources,
     * the Risk Assessor SHALL assign the Impact_Score corresponding to the highest-scoring path.
     */
    (0, vitest_1.it)('should assign the Impact_Score of the highest-scoring path when multiple paths exist', async () => {
        await fc.assert(fc.asyncProperty(arbitraryMultiPathScenario, async (scenario) => {
            const { numSources, sourceModTypes, pathDepths, targetCriticality, targetId, nodes, edges, manifestResources, } = scenario;
            const dependencyGraph = { nodes, edges };
            const manifest = {
                version: '1.0',
                metadata: {
                    submittedAt: new Date().toISOString(),
                    sourceFormat: 'canonical',
                },
                resources: manifestResources,
            };
            const input = { dependencyGraph, manifest };
            const result = await (0, handler_1.handler)(input);
            // Find the scored target resource
            const targetScored = result.scoredResources.find((r) => r.resourceId === targetId);
            // Target must be scored
            (0, vitest_1.expect)(targetScored).toBeDefined();
            // Compute expected max score
            const expectedMaxScore = computeExpectedMaxScore(numSources, sourceModTypes, pathDepths, targetCriticality);
            // The assigned score must equal the maximum path score
            (0, vitest_1.expect)(targetScored.impactScore).toBe(expectedMaxScore);
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 4.6**
     *
     * The score assigned via multi-path should always be >= any individual path's score.
     */
    (0, vitest_1.it)('should assign a score that is >= the score from any single path', async () => {
        await fc.assert(fc.asyncProperty(arbitraryMultiPathScenario, async (scenario) => {
            const { numSources, sourceModTypes, pathDepths, targetCriticality, targetId, nodes, edges, manifestResources, } = scenario;
            const dependencyGraph = { nodes, edges };
            const manifest = {
                version: '1.0',
                metadata: {
                    submittedAt: new Date().toISOString(),
                    sourceFormat: 'canonical',
                },
                resources: manifestResources,
            };
            const input = { dependencyGraph, manifest };
            const result = await (0, handler_1.handler)(input);
            const targetScored = result.scoredResources.find((r) => r.resourceId === targetId);
            (0, vitest_1.expect)(targetScored).toBeDefined();
            const criticalityConfig = (0, core_1.createCriticalityConfig)();
            const criticalityScore = CRITICALITY_SCORES[criticalityConfig.getCriticality(scenario.targetResourceType)];
            // Verify the assigned score is >= every individual path score
            for (let i = 0; i < numSources; i++) {
                const depth = pathDepths[i];
                const depthScore = (0, handler_1.computeDepthScore)(depth);
                const changeTypeSev = CHANGE_TYPE_SEVERITY[sourceModTypes[i]];
                const pathScore = (0, handler_1.computeImpactScore)(depthScore, criticalityScore, changeTypeSev);
                (0, vitest_1.expect)(targetScored.impactScore).toBeGreaterThanOrEqual(pathScore);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 4.6**
     *
     * When all paths produce the same score, the assigned score equals that common value.
     */
    (0, vitest_1.it)('should assign the common score when all paths produce the same score', async () => {
        await fc.assert(fc.asyncProperty(fc.record({
            modType: arbitraryModificationType,
            depth: fc.integer({ min: 1, max: 5 }),
            targetCriticality: arbitraryCriticality,
            numSources: fc.integer({ min: 2, max: 4 }),
        }), async ({ modType, depth, targetCriticality, numSources }) => {
            const targetId = 'target-resource';
            const targetResourceType = RESOURCE_TYPES_BY_CRITICALITY[targetCriticality];
            const nodes = [];
            const edges = [];
            const manifestResources = [];
            // Target node
            nodes.push({
                resourceId: targetId,
                resourceType: targetResourceType,
                provider: 'aws',
                region: 'us-east-1',
                accountId: '123456789012',
                isDirectChange: false,
                dependencyCoverage: 'full',
            });
            // All sources have same modType and same depth
            for (let i = 0; i < numSources; i++) {
                const sourceId = `source-${i}`;
                nodes.push({
                    resourceId: sourceId,
                    resourceType: 'AWS::EC2::Instance',
                    provider: 'aws',
                    region: 'us-east-1',
                    accountId: '123456789012',
                    isDirectChange: true,
                    dependencyCoverage: 'full',
                });
                manifestResources.push({
                    resourceId: sourceId,
                    resourceType: 'AWS::EC2::Instance',
                    provider: 'aws',
                    modificationType: modType,
                    region: 'us-east-1',
                    accountId: '123456789012',
                });
                // Build path of given depth
                let prevNodeId = sourceId;
                for (let d = 1; d < depth; d++) {
                    const intermediateId = `intermediate-${i}-${d}`;
                    nodes.push({
                        resourceId: intermediateId,
                        resourceType: 'AWS::SNS::Topic',
                        provider: 'aws',
                        region: 'us-east-1',
                        accountId: '123456789012',
                        isDirectChange: false,
                        dependencyCoverage: 'full',
                    });
                    edges.push({
                        sourceId: prevNodeId,
                        targetId: intermediateId,
                        relationshipType: 'references',
                        depth: d,
                    });
                    prevNodeId = intermediateId;
                }
                edges.push({
                    sourceId: prevNodeId,
                    targetId: targetId,
                    relationshipType: 'references',
                    depth: depth,
                });
            }
            const dependencyGraph = { nodes, edges };
            const manifest = {
                version: '1.0',
                metadata: {
                    submittedAt: new Date().toISOString(),
                    sourceFormat: 'canonical',
                },
                resources: manifestResources,
            };
            const input = { dependencyGraph, manifest };
            const result = await (0, handler_1.handler)(input);
            const targetScored = result.scoredResources.find((r) => r.resourceId === targetId);
            (0, vitest_1.expect)(targetScored).toBeDefined();
            // All paths have same score, so the result should equal that score
            const depthScore = (0, handler_1.computeDepthScore)(depth);
            const criticalityScore = CRITICALITY_SCORES[targetCriticality];
            const changeTypeSev = CHANGE_TYPE_SEVERITY[modType];
            const expectedScore = (0, handler_1.computeImpactScore)(depthScore, criticalityScore, changeTypeSev);
            (0, vitest_1.expect)(targetScored.impactScore).toBe(expectedScore);
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=multi-path.spec.js.map