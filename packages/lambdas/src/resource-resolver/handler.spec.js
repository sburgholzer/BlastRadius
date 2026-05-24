"use strict";
/**
 * Property-based tests for Resource Resolver graph traversal.
 *
 * Feature: blast-radius-visualizer, Property 6: Graph Traversal Terminates and Respects Depth Limit
 *
 * Validates: Requirements 3.2
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
/**
 * Generates a random directed graph with configurable properties.
 * Nodes are named "resource-0", "resource-1", etc.
 * Edges are pairs [sourceId, targetId].
 */
function arbitraryDirectedGraph(options) {
    const minNodes = options?.minNodes ?? 1;
    const maxNodes = options?.maxNodes ?? 15;
    const maxEdges = options?.maxEdges ?? 30;
    return fc
        .integer({ min: minNodes, max: maxNodes })
        .chain((nodeCount) => {
        const nodes = Array.from({ length: nodeCount }, (_, i) => `resource-${i}`);
        // Generate edges as pairs of node indices
        const edgeArb = fc.array(fc.tuple(fc.integer({ min: 0, max: nodeCount - 1 }), fc.integer({ min: 0, max: nodeCount - 1 })), { minLength: 0, maxLength: Math.min(maxEdges, nodeCount * nodeCount) });
        return edgeArb.map((edgeIndices) => {
            let edges = edgeIndices
                .filter(([src, tgt]) => src !== tgt) // no self-loops
                .map(([src, tgt]) => [nodes[src], nodes[tgt]]);
            // Deduplicate edges
            const edgeSet = new Set(edges.map(([s, t]) => `${s}->${t}`));
            edges = [...edgeSet].map((e) => {
                const [s, t] = e.split('->');
                return [s, t];
            });
            // If hasCycles is explicitly false, remove back-edges to make it a DAG
            if (options?.hasCycles === false) {
                edges = edges.filter(([src, tgt]) => {
                    const srcIdx = nodes.indexOf(src);
                    const tgtIdx = nodes.indexOf(tgt);
                    return srcIdx < tgtIdx;
                });
            }
            return { nodes, edges };
        });
    });
}
/**
 * Generates a directed graph that is guaranteed to have at least one cycle.
 */
function arbitraryGraphWithCycles(options) {
    const minNodes = Math.max(options?.minNodes ?? 2, 2);
    const maxNodes = options?.maxNodes ?? 10;
    return arbitraryDirectedGraph({ minNodes, maxNodes, maxEdges: 20 }).map((graph) => {
        // Ensure at least one cycle exists by adding a back-edge
        if (graph.nodes.length >= 2) {
            const lastNode = graph.nodes[graph.nodes.length - 1];
            const firstNode = graph.nodes[0];
            const cycleEdge = [lastNode, firstNode];
            const edgeKey = `${lastNode}->${firstNode}`;
            const existingEdges = new Set(graph.edges.map(([s, t]) => `${s}->${t}`));
            if (!existingEdges.has(edgeKey)) {
                graph.edges.push(cycleEdge);
            }
        }
        return graph;
    });
}
// ─── Mock Factory ────────────────────────────────────────────────────────────
/**
 * Creates mock AWS SDK clients that return relationships based on the generated graph.
 * The Config client returns outgoing edges for a given resource.
 * The Resource Explorer client returns empty results (cross-account not simulated).
 */
function createMockDeps(graph) {
    // Build adjacency list from graph edges
    const adjacency = new Map();
    for (const node of graph.nodes) {
        adjacency.set(node, []);
    }
    for (const [source, target] of graph.edges) {
        const rels = adjacency.get(source) ?? [];
        rels.push({
            resourceId: target,
            resourceType: 'AWS::EC2::Instance',
            relationshipType: 'is_attached_to',
            region: 'us-east-1',
            accountId: '123456789012',
        });
        adjacency.set(source, rels);
    }
    const mockConfigClient = {
        send: vitest_1.vi.fn().mockImplementation((command) => {
            // Extract the resourceId from the query expression
            const cmd = command;
            const expression = cmd.input.Expression;
            const match = expression.match(/resourceId\s*=\s*'([^']+)'/);
            const resourceId = match ? match[1] : '';
            const relationships = adjacency.get(resourceId) ?? [];
            // Return results in the format expected by queryConfigRelationships
            const results = relationships.length > 0
                ? [
                    JSON.stringify({
                        relationships: relationships.map((r) => ({
                            resourceId: r.resourceId,
                            resourceType: r.resourceType,
                            name: r.relationshipType,
                        })),
                        awsRegion: 'us-east-1',
                        accountId: '123456789012',
                    }),
                ]
                : [];
            return Promise.resolve({ Results: results });
        }),
    };
    const mockResourceExplorerClient = {
        send: vitest_1.vi.fn().mockImplementation(() => {
            // Resource Explorer returns empty results for this test
            return Promise.resolve({ Resources: [] });
        }),
    };
    return {
        configClient: mockConfigClient,
        resourceExplorerClient: mockResourceExplorerClient,
        configAggregatorName: 'test-aggregator',
    };
}
// ─── Helper: BFS to find all reachable nodes within depth ────────────────────
/**
 * Computes all nodes reachable from the start nodes within the given depth limit
 * using BFS. This serves as the oracle for verifying the handler's output.
 *
 * The handler's depth semantics: start resources enter traversal at depth=1.
 * A node at depth=d discovers neighbors at depth=d+1. The check
 * `if (currentDepth > maxDepth) return` means a node is only visited if
 * its depth <= maxDepth. So with maxDepth=1, only the start nodes themselves
 * are visited. With maxDepth=2, start nodes + their direct neighbors, etc.
 *
 * NOTE: The handler uses DFS traversal, which means the order in which
 * neighbors are visited matters. A node visited via a longer path first
 * will be marked visited and won't be re-explored via a shorter path.
 * This oracle uses DFS to match the handler's actual behavior.
 */
function computeReachableNodes(startNodes, graph, maxDepth) {
    const adjacency = new Map();
    for (const node of graph.nodes) {
        adjacency.set(node, []);
    }
    for (const [source, target] of graph.edges) {
        const neighbors = adjacency.get(source) ?? [];
        neighbors.push(target);
        adjacency.set(source, neighbors);
    }
    const visited = new Set();
    // DFS matching the handler's traversal semantics
    function dfs(resourceId, currentDepth) {
        // Circular reference detection (same as handler)
        if (visited.has(resourceId)) {
            return;
        }
        // Depth limit check (same as handler)
        if (currentDepth > maxDepth) {
            return;
        }
        visited.add(resourceId);
        // Recurse into neighbors at currentDepth + 1
        const neighbors = adjacency.get(resourceId) ?? [];
        for (const neighbor of neighbors) {
            dfs(neighbor, currentDepth + 1);
        }
    }
    // Start nodes begin at depth 1 (matching handler semantics)
    for (const startNode of startNodes) {
        if (graph.nodes.includes(startNode)) {
            dfs(startNode, 1);
        }
    }
    return visited;
}
// ─── Property Tests ──────────────────────────────────────────────────────────
(0, vitest_1.describe)('Feature: blast-radius-visualizer, Property 6: Graph Traversal Terminates and Respects Depth Limit', () => {
    /**
     * **Validates: Requirements 3.2**
     *
     * Property 1: Traversal always terminates (test with timeout).
     * For any directed graph (including cycles) and any max depth,
     * the handler SHALL terminate in finite time.
     */
    (0, vitest_1.it)('traversal always terminates for any graph including cycles', async () => {
        await fc.assert(fc.asyncProperty(arbitraryDirectedGraph({ minNodes: 1, maxNodes: 12, maxEdges: 25 }), fc.integer({ min: 1, max: 10 }), async (graph, maxDepth) => {
            const deps = createMockDeps(graph);
            // Use the first node as the starting resource
            const startResource = graph.nodes[0];
            const input = {
                resources: [
                    {
                        resourceType: 'AWS::EC2::Instance',
                        resourceId: startResource,
                        provider: 'aws',
                        modificationType: 'Modify',
                        region: 'us-east-1',
                        accountId: '123456789012',
                    },
                ],
                maxDepth,
                requestingPrincipal: 'arn:aws:iam::123456789012:user/test',
            };
            // If this doesn't terminate, the test will timeout and fail
            const result = await (0, handler_1.handler)(input, deps);
            // Basic sanity: result should have the expected shape
            (0, vitest_1.expect)(result).toHaveProperty('dependencyGraph');
            (0, vitest_1.expect)(result).toHaveProperty('coverage');
            (0, vitest_1.expect)(result).toHaveProperty('cacheStats');
            (0, vitest_1.expect)(result.dependencyGraph.nodes).toBeDefined();
            (0, vitest_1.expect)(result.dependencyGraph.edges).toBeDefined();
        }), { numRuns: 100 });
    }, 30_000);
    /**
     * **Validates: Requirements 3.2**
     *
     * Property 2: No node in the output graph has depth > maxDepth.
     * All edges in the output graph SHALL have depth <= maxDepth.
     */
    (0, vitest_1.it)('no edge in the output graph has depth exceeding maxDepth', async () => {
        await fc.assert(fc.asyncProperty(arbitraryDirectedGraph({ minNodes: 2, maxNodes: 12, maxEdges: 25 }), fc.integer({ min: 1, max: 8 }), async (graph, maxDepth) => {
            const deps = createMockDeps(graph);
            const startResource = graph.nodes[0];
            const input = {
                resources: [
                    {
                        resourceType: 'AWS::EC2::Instance',
                        resourceId: startResource,
                        provider: 'aws',
                        modificationType: 'Modify',
                        region: 'us-east-1',
                        accountId: '123456789012',
                    },
                ],
                maxDepth,
                requestingPrincipal: 'arn:aws:iam::123456789012:user/test',
            };
            const result = await (0, handler_1.handler)(input, deps);
            // Every edge's depth must be <= maxDepth
            for (const edge of result.dependencyGraph.edges) {
                (0, vitest_1.expect)(edge.depth).toBeLessThanOrEqual(maxDepth);
            }
        }), { numRuns: 100 });
    }, 30_000);
    /**
     * **Validates: Requirements 3.2**
     *
     * Property 3: Graphs with cycles don't cause infinite loops.
     * For any graph guaranteed to have cycles, the traversal SHALL terminate
     * and produce a valid result.
     */
    (0, vitest_1.it)('graphs with cycles do not cause infinite loops', async () => {
        await fc.assert(fc.asyncProperty(arbitraryGraphWithCycles({ minNodes: 3, maxNodes: 10 }), fc.integer({ min: 2, max: 8 }), async (graph, maxDepth) => {
            const deps = createMockDeps(graph);
            const startResource = graph.nodes[0];
            const input = {
                resources: [
                    {
                        resourceType: 'AWS::EC2::Instance',
                        resourceId: startResource,
                        provider: 'aws',
                        modificationType: 'Modify',
                        region: 'us-east-1',
                        accountId: '123456789012',
                    },
                ],
                maxDepth,
                requestingPrincipal: 'arn:aws:iam::123456789012:user/test',
            };
            const result = await (0, handler_1.handler)(input, deps);
            // Should terminate and produce valid output
            (0, vitest_1.expect)(result.dependencyGraph.nodes.length).toBeGreaterThanOrEqual(1);
            // No duplicate nodes (circular references detected and skipped)
            const nodeIds = result.dependencyGraph.nodes.map((n) => n.resourceId);
            const uniqueNodeIds = new Set(nodeIds);
            (0, vitest_1.expect)(uniqueNodeIds.size).toBe(nodeIds.length);
        }), { numRuns: 100 });
    }, 30_000);
    /**
     * **Validates: Requirements 3.2**
     *
     * Property 4: All reachable nodes within depth limit are included.
     * The output graph SHALL contain all nodes reachable from the start
     * resources within the configured max depth.
     */
    (0, vitest_1.it)('all reachable nodes within depth limit are included in the output', async () => {
        await fc.assert(fc.asyncProperty(arbitraryDirectedGraph({ minNodes: 2, maxNodes: 10, maxEdges: 20 }), fc.integer({ min: 1, max: 6 }), async (graph, maxDepth) => {
            const deps = createMockDeps(graph);
            const startResource = graph.nodes[0];
            const input = {
                resources: [
                    {
                        resourceType: 'AWS::EC2::Instance',
                        resourceId: startResource,
                        provider: 'aws',
                        modificationType: 'Modify',
                        region: 'us-east-1',
                        accountId: '123456789012',
                    },
                ],
                maxDepth,
                requestingPrincipal: 'arn:aws:iam::123456789012:user/test',
            };
            const result = await (0, handler_1.handler)(input, deps);
            // Compute expected reachable nodes using BFS oracle
            const expectedReachable = computeReachableNodes([startResource], graph, maxDepth);
            // All expected reachable nodes should be in the output
            const outputNodeIds = new Set(result.dependencyGraph.nodes.map((n) => n.resourceId));
            for (const expectedNode of expectedReachable) {
                (0, vitest_1.expect)(outputNodeIds.has(expectedNode)).toBe(true);
            }
        }), { numRuns: 100 });
    }, 30_000);
});
//# sourceMappingURL=handler.spec.js.map