"use strict";
/**
 * Property-based tests for access scoping.
 *
 * Feature: blast-radius-visualizer
 * Property 18: Access Scoping Excludes Unauthorized Resources
 *
 * Validates: Requirements 9.3, 9.4, 9.5
 *
 * For any requesting principal and any set of discovered resources spanning
 * multiple accounts, the analysis results SHALL contain zero resources from
 * accounts where the principal lacks read permissions, and SHALL include a
 * summary of excluded accounts.
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
const access_scoper_1 = require("./access-scoper");
// ─── Custom Arbitraries / Generators ─────────────────────────────────────────
const RISK_CATEGORIES = ['Critical', 'High', 'Medium', 'Low'];
const CRITICALITY_CLASSIFICATIONS = ['Critical', 'High', 'Medium', 'Low'];
const REGIONS = [
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'eu-central-1',
    'ap-southeast-1',
    'ap-northeast-1',
];
const RESOURCE_TYPES = [
    'AWS::EC2::Instance',
    'AWS::RDS::DBInstance',
    'AWS::Lambda::Function',
    'AWS::S3::Bucket',
    'AWS::DynamoDB::Table',
    'AWS::EC2::SecurityGroup',
];
const RELATIONSHIP_TYPES = ['is_attached_to', 'references', 'is_contained_in', 'invokes'];
/** Generates a 12-digit AWS account ID. */
function arbitraryAccountId() {
    return fc.stringOf(fc.constantFrom(...'0123456789'.split('')), {
        minLength: 12,
        maxLength: 12,
    });
}
/** Generates a unique resource ID. */
function arbitraryResourceId() {
    return fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 4, maxLength: 12 }).map((s) => `res-${s}`);
}
/** Generates a dependency node with a specific account and region. */
function arbitraryNode(accountId, region) {
    return fc.record({
        resourceId: arbitraryResourceId(),
        resourceType: fc.constantFrom(...RESOURCE_TYPES),
        provider: fc.constant('aws'),
        region,
        accountId,
        isDirectChange: fc.boolean(),
        dependencyCoverage: fc.constantFrom('full', 'partial', 'unknown'),
    });
}
/** Generates a scored resource with a specific account and region. */
function arbitraryScoredResource(accountId, region) {
    return fc.record({
        resourceId: arbitraryResourceId(),
        resourceType: fc.constantFrom(...RESOURCE_TYPES),
        provider: fc.constant('aws'),
        region,
        accountId,
        impactScore: fc.integer({ min: 0, max: 100 }),
        riskCategory: fc.constantFrom(...RISK_CATEGORIES),
        dependencyChain: fc.array(arbitraryResourceId(), { minLength: 1, maxLength: 5 }),
        dependencyDepth: fc.integer({ min: 1, max: 10 }),
        criticalityClassification: fc.constantFrom(...CRITICALITY_CLASSIFICATIONS),
        changeTypeSeverity: fc.constantFrom(100, 80, 50),
        highestRiskPath: fc.array(fc.record({
            sourceId: arbitraryResourceId(),
            targetId: arbitraryResourceId(),
            relationshipType: fc.constantFrom(...RELATIONSHIP_TYPES),
            depth: fc.integer({ min: 1, max: 10 }),
        }), { minLength: 0, maxLength: 3 }),
    });
}
/**
 * Generates a multi-account dependency graph with nodes from both authorized
 * and unauthorized accounts, plus edges between them.
 */
function arbitraryMultiAccountGraph() {
    return fc
        .record({
        authorizedAccounts: fc.uniqueArray(arbitraryAccountId(), { minLength: 1, maxLength: 3 }),
        unauthorizedAccounts: fc.uniqueArray(arbitraryAccountId(), { minLength: 1, maxLength: 3 }),
        authorizedRegions: fc.uniqueArray(fc.constantFrom(...REGIONS), { minLength: 1, maxLength: 3 }),
    })
        .filter(({ authorizedAccounts, unauthorizedAccounts }) => 
    // Ensure no overlap between authorized and unauthorized accounts
    !authorizedAccounts.some((a) => unauthorizedAccounts.includes(a)))
        .chain(({ authorizedAccounts, unauthorizedAccounts, authorizedRegions }) => {
        // Generate nodes from authorized accounts/regions
        const authorizedNodesArb = fc.array(arbitraryNode(fc.constantFrom(...authorizedAccounts), fc.constantFrom(...authorizedRegions)), { minLength: 1, maxLength: 10 });
        // Generate nodes from unauthorized accounts (using any region)
        const unauthorizedNodesArb = fc.array(arbitraryNode(fc.constantFrom(...unauthorizedAccounts), fc.constantFrom(...REGIONS)), { minLength: 1, maxLength: 10 });
        return fc
            .record({
            authorizedNodes: authorizedNodesArb,
            unauthorizedNodes: unauthorizedNodesArb,
        })
            .map(({ authorizedNodes, unauthorizedNodes }) => {
            // Ensure unique resource IDs across all nodes
            const allNodes = [...authorizedNodes, ...unauthorizedNodes];
            const seen = new Set();
            const uniqueNodes = [];
            for (const node of allNodes) {
                if (!seen.has(node.resourceId)) {
                    seen.add(node.resourceId);
                    uniqueNodes.push(node);
                }
            }
            // Generate edges between random pairs of nodes
            const edges = [];
            for (let i = 0; i < uniqueNodes.length - 1; i++) {
                edges.push({
                    sourceId: uniqueNodes[i].resourceId,
                    targetId: uniqueNodes[i + 1].resourceId,
                    relationshipType: RELATIONSHIP_TYPES[i % RELATIONSHIP_TYPES.length],
                    depth: (i % 5) + 1,
                });
            }
            return {
                graph: { nodes: uniqueNodes, edges },
                authorizedAccounts,
                unauthorizedAccounts,
                authorizedRegions,
            };
        });
    });
}
/**
 * Generates a multi-account set of scored resources from both authorized
 * and unauthorized accounts.
 */
function arbitraryMultiAccountResources() {
    return fc
        .record({
        authorizedAccounts: fc.uniqueArray(arbitraryAccountId(), { minLength: 1, maxLength: 3 }),
        unauthorizedAccounts: fc.uniqueArray(arbitraryAccountId(), { minLength: 1, maxLength: 3 }),
        authorizedRegions: fc.uniqueArray(fc.constantFrom(...REGIONS), { minLength: 1, maxLength: 3 }),
    })
        .filter(({ authorizedAccounts, unauthorizedAccounts }) => !authorizedAccounts.some((a) => unauthorizedAccounts.includes(a)))
        .chain(({ authorizedAccounts, unauthorizedAccounts, authorizedRegions }) => {
        const authorizedResourcesArb = fc.array(arbitraryScoredResource(fc.constantFrom(...authorizedAccounts), fc.constantFrom(...authorizedRegions)), { minLength: 1, maxLength: 10 });
        const unauthorizedResourcesArb = fc.array(arbitraryScoredResource(fc.constantFrom(...unauthorizedAccounts), fc.constantFrom(...REGIONS)), { minLength: 1, maxLength: 10 });
        return fc
            .record({
            authorizedResources: authorizedResourcesArb,
            unauthorizedResources: unauthorizedResourcesArb,
        })
            .map(({ authorizedResources, unauthorizedResources }) => ({
            resources: [...authorizedResources, ...unauthorizedResources],
            authorizedAccounts,
            unauthorizedAccounts,
            authorizedRegions,
        }));
    });
}
// ─── Property Tests ──────────────────────────────────────────────────────────
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 18: Access Scoping Excludes Unauthorized Resources', () => {
    /**
     * **Validates: Requirements 9.3, 9.4, 9.5**
     *
     * scopeDependencyGraph results contain zero resources from unauthorized accounts.
     */
    (0, vitest_1.it)('scoped dependency graph contains zero nodes from unauthorized accounts', () => {
        fc.assert(fc.property(arbitraryMultiAccountGraph(), ({ graph, authorizedAccounts, authorizedRegions }) => {
            const policy = {
                authorizedAccounts,
                authorizedRegions,
            };
            const result = (0, access_scoper_1.scopeDependencyGraph)(graph, policy);
            // Verify: no node in the result belongs to an unauthorized account
            for (const node of result.graph.nodes) {
                (0, vitest_1.expect)(authorizedAccounts).toContain(node.accountId);
            }
            // Verify: no node in the result belongs to an unauthorized region
            for (const node of result.graph.nodes) {
                (0, vitest_1.expect)(authorizedRegions).toContain(node.region);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 9.3, 9.4, 9.5**
     *
     * scopeScoredResources results contain zero resources from unauthorized accounts.
     */
    (0, vitest_1.it)('scoped scored resources contain zero entries from unauthorized accounts', () => {
        fc.assert(fc.property(arbitraryMultiAccountResources(), ({ resources, authorizedAccounts, authorizedRegions }) => {
            const policy = {
                authorizedAccounts,
                authorizedRegions,
            };
            const result = (0, access_scoper_1.scopeScoredResources)(resources, policy);
            // Verify: no resource in the result belongs to an unauthorized account
            for (const resource of result.resources) {
                (0, vitest_1.expect)(authorizedAccounts).toContain(resource.accountId);
            }
            // Verify: no resource in the result belongs to an unauthorized region
            for (const resource of result.resources) {
                (0, vitest_1.expect)(authorizedRegions).toContain(resource.region);
            }
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 9.4, 9.5**
     *
     * When unauthorized resources are excluded, the exclusion summary includes
     * the excluded accounts.
     */
    (0, vitest_1.it)('exclusion summary lists all excluded accounts from dependency graph scoping', () => {
        fc.assert(fc.property(arbitraryMultiAccountGraph(), ({ graph, authorizedAccounts, unauthorizedAccounts, authorizedRegions }) => {
            const policy = {
                authorizedAccounts,
                authorizedRegions,
            };
            const result = (0, access_scoper_1.scopeDependencyGraph)(graph, policy);
            // Find which unauthorized accounts actually had nodes in the graph
            const unauthorizedAccountsInGraph = new Set(graph.nodes
                .filter((n) => unauthorizedAccounts.includes(n.accountId))
                .map((n) => n.accountId));
            // Every unauthorized account that had nodes should appear in the exclusion summary
            for (const account of unauthorizedAccountsInGraph) {
                (0, vitest_1.expect)(result.exclusionSummary.excludedAccounts).toContain(account);
            }
            // The omitted count should match the number of excluded nodes
            const excludedNodeCount = graph.nodes.filter((n) => !authorizedAccounts.includes(n.accountId) ||
                !authorizedRegions.includes(n.region)).length;
            (0, vitest_1.expect)(result.exclusionSummary.omittedResourceCount).toBe(excludedNodeCount);
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 9.4, 9.5**
     *
     * When unauthorized resources are excluded, the exclusion summary includes
     * the excluded accounts for scored resources.
     */
    (0, vitest_1.it)('exclusion summary lists all excluded accounts from scored resources scoping', () => {
        fc.assert(fc.property(arbitraryMultiAccountResources(), ({ resources, authorizedAccounts, unauthorizedAccounts, authorizedRegions }) => {
            const policy = {
                authorizedAccounts,
                authorizedRegions,
            };
            const result = (0, access_scoper_1.scopeScoredResources)(resources, policy);
            // Find which unauthorized accounts actually had resources
            const unauthorizedAccountsInResources = new Set(resources
                .filter((r) => unauthorizedAccounts.includes(r.accountId))
                .map((r) => r.accountId));
            // Every unauthorized account that had resources should appear in the exclusion summary
            for (const account of unauthorizedAccountsInResources) {
                (0, vitest_1.expect)(result.exclusionSummary.excludedAccounts).toContain(account);
            }
            // The omitted count should match the number of excluded resources
            const excludedResourceCount = resources.filter((r) => !authorizedAccounts.includes(r.accountId) ||
                !authorizedRegions.includes(r.region)).length;
            (0, vitest_1.expect)(result.exclusionSummary.omittedResourceCount).toBe(excludedResourceCount);
        }), { numRuns: 100 });
    });
    /**
     * **Validates: Requirements 9.3, 9.5**
     *
     * Edges in the scoped graph only reference authorized nodes — no edge
     * connects to or from an unauthorized resource.
     */
    (0, vitest_1.it)('scoped graph edges only reference authorized nodes', () => {
        fc.assert(fc.property(arbitraryMultiAccountGraph(), ({ graph, authorizedAccounts, authorizedRegions }) => {
            const policy = {
                authorizedAccounts,
                authorizedRegions,
            };
            const result = (0, access_scoper_1.scopeDependencyGraph)(graph, policy);
            const authorizedNodeIds = new Set(result.graph.nodes.map((n) => n.resourceId));
            for (const edge of result.graph.edges) {
                (0, vitest_1.expect)(authorizedNodeIds.has(edge.sourceId)).toBe(true);
                (0, vitest_1.expect)(authorizedNodeIds.has(edge.targetId)).toBe(true);
            }
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=access-scoper.property.spec.js.map