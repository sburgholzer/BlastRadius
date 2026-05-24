/**
 * Scored resource and risk classification data models.
 *
 * Used by the Risk Assessor to represent impact analysis results
 * for each affected resource in the dependency graph.
 */

import type { DependencyEdge } from './dependency-graph';

/** Risk category classification based on Impact_Score ranges. */
export type RiskCategory = 'Critical' | 'High' | 'Medium' | 'Low';

/** Criticality classification for resource types. */
export type CriticalityClassification = 'Critical' | 'High' | 'Medium' | 'Low';

/** A resource with its computed impact score and risk metadata. */
export interface ScoredResource {
  resourceId: string;
  resourceType: string;
  provider: string;
  region: string;
  accountId: string;
  impactScore: number;
  riskCategory: RiskCategory;
  dependencyChain: string[];
  dependencyDepth: number;
  criticalityClassification: CriticalityClassification;
  changeTypeSeverity: number;
  highestRiskPath: DependencyEdge[];
}

/** Summary of risk distribution across all scored resources. */
export interface RiskSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  totalAffected: number;
  highestScore: number;
}
