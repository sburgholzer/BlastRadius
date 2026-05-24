import { useCallback, useMemo, useState } from 'react';
import type { RiskCategory, ScoredResource } from '../api/types';

/** Active filter state for the dependency graph. */
export interface GraphFilterState {
  riskCategories: Set<RiskCategory>;
  resourceTypes: Set<string>;
  sourceTools: Set<string>;
}

/** Props for the GraphFilters component. */
export interface GraphFiltersProps {
  /** All scored resources from the analysis result (unfiltered). */
  scoredResources: ScoredResource[];
  /** The source IaC tool format used for this analysis. */
  sourceFormat: string;
  /** Available source formats for filtering (when multiple analyses are shown). */
  availableSourceFormats?: string[];
  /** Callback invoked when filters change. Receives the filtered resource list. */
  onFilterChange: (filtered: ScoredResource[], filters: GraphFilterState) => void;
}

const ALL_RISK_CATEGORIES: RiskCategory[] = ['Critical', 'High', 'Medium', 'Low'];

const RISK_CATEGORY_COLORS: Record<RiskCategory, string> = {
  Critical: '#dc2626',
  High: '#ea580c',
  Medium: '#ca8a04',
  Low: '#16a34a',
};

/**
 * Applies the given filter state to a list of scored resources.
 * Returns only resources matching ALL active filter criteria.
 * A filter with no selections means "show all" for that dimension.
 */
export function applyFilters(
  resources: ScoredResource[],
  filters: GraphFilterState,
): ScoredResource[] {
  return resources.filter((resource) => {
    const matchesRisk =
      filters.riskCategories.size === 0 ||
      filters.riskCategories.has(resource.riskCategory);

    const matchesType =
      filters.resourceTypes.size === 0 ||
      filters.resourceTypes.has(resource.resourceType);

    const matchesTool =
      filters.sourceTools.size === 0 ||
      filters.sourceTools.has(resource.provider);

    return matchesRisk && matchesType && matchesTool;
  });
}

/**
 * GraphFilters provides filter controls for the dependency graph visualization.
 * Supports filtering by risk category, resource type, and source IaC tool.
 * Filter state is maintained across interactions and updates are applied immediately.
 *
 * Validates: Requirements 6.4
 */
export function GraphFilters({
  scoredResources,
  sourceFormat,
  availableSourceFormats,
  onFilterChange,
}: GraphFiltersProps) {
  const [filters, setFilters] = useState<GraphFilterState>({
    riskCategories: new Set(),
    resourceTypes: new Set(),
    sourceTools: new Set(),
  });

  // Derive available resource types from the data
  const availableResourceTypes = useMemo(() => {
    const types = new Set<string>();
    for (const resource of scoredResources) {
      types.add(resource.resourceType);
    }
    return Array.from(types).sort();
  }, [scoredResources]);

  // Derive available source tools from the data or props
  const availableTools = useMemo(() => {
    if (availableSourceFormats && availableSourceFormats.length > 0) {
      return availableSourceFormats.sort();
    }
    const tools = new Set<string>();
    for (const resource of scoredResources) {
      tools.add(resource.provider);
    }
    // Also include the analysis source format
    if (sourceFormat) {
      tools.add(sourceFormat);
    }
    return Array.from(tools).sort();
  }, [scoredResources, sourceFormat, availableSourceFormats]);

  // Apply filters and notify parent
  const applyAndNotify = useCallback(
    (newFilters: GraphFilterState) => {
      const filtered = applyFilters(scoredResources, newFilters);
      onFilterChange(filtered, newFilters);
    },
    [scoredResources, onFilterChange],
  );

  const handleRiskCategoryToggle = useCallback(
    (category: RiskCategory) => {
      setFilters((prev) => {
        const next = new Set(prev.riskCategories);
        if (next.has(category)) {
          next.delete(category);
        } else {
          next.add(category);
        }
        const newFilters = { ...prev, riskCategories: next };
        applyAndNotify(newFilters);
        return newFilters;
      });
    },
    [applyAndNotify],
  );

  const handleResourceTypeToggle = useCallback(
    (resourceType: string) => {
      setFilters((prev) => {
        const next = new Set(prev.resourceTypes);
        if (next.has(resourceType)) {
          next.delete(resourceType);
        } else {
          next.add(resourceType);
        }
        const newFilters = { ...prev, resourceTypes: next };
        applyAndNotify(newFilters);
        return newFilters;
      });
    },
    [applyAndNotify],
  );

  const handleSourceToolToggle = useCallback(
    (tool: string) => {
      setFilters((prev) => {
        const next = new Set(prev.sourceTools);
        if (next.has(tool)) {
          next.delete(tool);
        } else {
          next.add(tool);
        }
        const newFilters = { ...prev, sourceTools: next };
        applyAndNotify(newFilters);
        return newFilters;
      });
    },
    [applyAndNotify],
  );

  const handleClearAll = useCallback(() => {
    const cleared: GraphFilterState = {
      riskCategories: new Set(),
      resourceTypes: new Set(),
      sourceTools: new Set(),
    };
    setFilters(cleared);
    applyAndNotify(cleared);
  }, [applyAndNotify]);

  const activeFilterCount =
    filters.riskCategories.size +
    filters.resourceTypes.size +
    filters.sourceTools.size;

  return (
    <div className="graph-filters" role="region" aria-label="Graph filters">
      <div className="graph-filters__header">
        <h3 className="graph-filters__title">Filters</h3>
        {activeFilterCount > 0 && (
          <button
            className="graph-filters__clear-btn"
            onClick={handleClearAll}
            aria-label="Clear all filters"
          >
            Clear all ({activeFilterCount})
          </button>
        )}
      </div>

      {/* Risk Category Filter */}
      <fieldset className="graph-filters__section">
        <legend className="graph-filters__section-title">Risk Category</legend>
        <div className="graph-filters__options">
          {ALL_RISK_CATEGORIES.map((category) => (
            <label
              key={category}
              className={`graph-filters__chip ${
                filters.riskCategories.has(category)
                  ? 'graph-filters__chip--active'
                  : ''
              }`}
              style={{
                borderColor: filters.riskCategories.has(category)
                  ? RISK_CATEGORY_COLORS[category]
                  : undefined,
                backgroundColor: filters.riskCategories.has(category)
                  ? `${RISK_CATEGORY_COLORS[category]}20`
                  : undefined,
              }}
            >
              <input
                type="checkbox"
                className="graph-filters__checkbox"
                checked={filters.riskCategories.has(category)}
                onChange={() => handleRiskCategoryToggle(category)}
                aria-label={`Filter by ${category} risk`}
              />
              <span
                className="graph-filters__chip-dot"
                style={{ backgroundColor: RISK_CATEGORY_COLORS[category] }}
              />
              {category}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Resource Type Filter */}
      <fieldset className="graph-filters__section">
        <legend className="graph-filters__section-title">Resource Type</legend>
        <div className="graph-filters__options graph-filters__options--scrollable">
          {availableResourceTypes.map((type) => (
            <label
              key={type}
              className={`graph-filters__chip ${
                filters.resourceTypes.has(type)
                  ? 'graph-filters__chip--active'
                  : ''
              }`}
            >
              <input
                type="checkbox"
                className="graph-filters__checkbox"
                checked={filters.resourceTypes.has(type)}
                onChange={() => handleResourceTypeToggle(type)}
                aria-label={`Filter by resource type ${type}`}
              />
              {type}
            </label>
          ))}
          {availableResourceTypes.length === 0 && (
            <span className="graph-filters__empty">No resource types available</span>
          )}
        </div>
      </fieldset>

      {/* Source IaC Tool Filter */}
      <fieldset className="graph-filters__section">
        <legend className="graph-filters__section-title">Source Tool</legend>
        <div className="graph-filters__options">
          {availableTools.map((tool) => (
            <label
              key={tool}
              className={`graph-filters__chip ${
                filters.sourceTools.has(tool)
                  ? 'graph-filters__chip--active'
                  : ''
              }`}
            >
              <input
                type="checkbox"
                className="graph-filters__checkbox"
                checked={filters.sourceTools.has(tool)}
                onChange={() => handleSourceToolToggle(tool)}
                aria-label={`Filter by source tool ${tool}`}
              />
              {tool}
            </label>
          ))}
          {availableTools.length === 0 && (
            <span className="graph-filters__empty">No source tools available</span>
          )}
        </div>
      </fieldset>

      {/* Active filter summary */}
      {activeFilterCount > 0 && (
        <div className="graph-filters__summary" aria-live="polite">
          Showing {applyFilters(scoredResources, filters).length} of{' '}
          {scoredResources.length} resources
        </div>
      )}
    </div>
  );
}
