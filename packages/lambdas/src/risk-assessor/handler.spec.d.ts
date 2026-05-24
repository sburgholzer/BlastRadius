/**
 * Property-based tests for Impact Score formula correctness.
 *
 * Feature: blast-radius-visualizer, Property 8: Impact Score Formula Correctness
 *
 * Validates: Requirements 4.2, 4.5
 *
 * For any combination of dependency depth (1-10), resource criticality
 * (Critical, High, Medium, Low), and change type (Remove, Replace, Modify),
 * the Risk Assessor SHALL compute Impact_Score as:
 *   round((depthScore * 0.30) + (criticalityScore * 0.40) + (changeTypeSeverity * 0.30))
 * where depthScore = max(10, 100 - ((depth-1) * 10)),
 *       criticalityScore ∈ {100, 75, 50, 25},
 *       changeTypeSeverity ∈ {100, 80, 50}.
 */
export {};
//# sourceMappingURL=handler.spec.d.ts.map