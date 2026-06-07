import { useCallback, useMemo, useState } from 'react';
import type { RiskCategory, ScoredResource } from '../api/types';

/** Active filter state for the dependency graph. */
export interface GraphFilterState {
  riskCategories: Set<RiskCategory>;
  resourceTypes: Set<string>;
  sourceTools: Set<string>;
  showDirectChanges: boolean;
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
    showDirectChanges: true,
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
      showDirectChanges: true,
    };
    setFilters(cleared);
    applyAndNotify(cleared);
  }, [applyAndNotify]);

  const activeFilterCount =
    filters.riskCategories.size +
    filters.resourceTypes.size +
    filters.sourceTools.size +
    (filters.showDirectChanges ? 0 : 1);

  const chipStyle = (active: boolean, color?: string): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.25rem 0.75rem',
    borderRadius: '9999px',
    border: `1px solid ${active ? (color ?? 'var(--color-primary, #3b82f6)') : 'var(--color-border, #334155)'}`,
    background: active ? `${color ?? 'var(--color-primary, #3b82f6)'}20` : 'transparent',
    cursor: 'pointer',
    fontSize: '0.75rem',
    color: active ? (color ?? 'var(--color-text, #f1f5f9)') : 'var(--color-text-muted, #94a3b8)',
    transition: 'all 0.15s',
    userSelect: 'none' as const,
  });

  return (
    <div role="region" aria-label="Graph filters" style={{
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '0.75rem',
      padding: '0.75rem 1rem',
      background: 'var(--color-surface, #1e293b)',
      border: '1px solid var(--color-border, #334155)',
      borderRadius: '0.5rem',
      marginBottom: '1rem',
    }}>
      {/* Label */}
      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #94a3b8)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Filter
      </span>
      <span style={{ fontSize: '0.625rem', color: 'var(--color-text-muted, #64748b)' }}>
        (click to toggle)
      </span>

      {/* Direct Change toggle */}
      <label style={chipStyle(filters.showDirectChanges, '#2b6cb0')}>
        <input
          type="checkbox"
          checked={filters.showDirectChanges}
          onChange={() => {
            setFilters((prev) => {
              const newFilters = { ...prev, showDirectChanges: !prev.showDirectChanges };
              applyAndNotify(newFilters);
              return newFilters;
            });
          }}
          aria-label="Toggle direct changes visibility"
          style={{ display: 'none' }}
        />
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2b6cb0' }} />
        Direct Changes
      </label>

      {/* Separator */}
      <span style={{ width: 1, height: 20, background: 'var(--color-border, #334155)' }} />

      {/* Risk Category chips */}
      {ALL_RISK_CATEGORIES.map((category) => (
        <label key={category} style={chipStyle(filters.riskCategories.has(category), RISK_CATEGORY_COLORS[category])}>
          <input
            type="checkbox"
            checked={filters.riskCategories.has(category)}
            onChange={() => handleRiskCategoryToggle(category)}
            aria-label={`Filter by ${category} risk`}
            style={{ display: 'none' }}
          />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: RISK_CATEGORY_COLORS[category] }} />
          {category}
        </label>
      ))}

      {/* Separator */}
      <span style={{ width: 1, height: 20, background: 'var(--color-border, #334155)' }} />

      {/* Resource Type chips */}
      {availableResourceTypes.map((type) => {
        const shortName = type.replace('AWS::', '').replace('::', '::');
        return (
          <label key={type} style={chipStyle(filters.resourceTypes.has(type))}>
            <input
              type="checkbox"
              checked={filters.resourceTypes.has(type)}
              onChange={() => handleResourceTypeToggle(type)}
              aria-label={`Filter by ${type}`}
              style={{ display: 'none' }}
            />
            {shortName}
          </label>
        );
      })}

      {/* Separator */}
      {availableTools.length > 0 && (
        <span style={{ width: 1, height: 20, background: 'var(--color-border, #334155)' }} />
      )}

      {/* Source Tool chips */}
      {availableTools.map((tool) => (
        <label key={tool} style={chipStyle(filters.sourceTools.has(tool))}>
          <input
            type="checkbox"
            checked={filters.sourceTools.has(tool)}
            onChange={() => handleSourceToolToggle(tool)}
            aria-label={`Filter by ${tool}`}
            style={{ display: 'none' }}
          />
          {tool}
        </label>
      ))}

      {/* Clear + count */}
      {activeFilterCount > 0 && (
        <>
          <span style={{ width: 1, height: 20, background: 'var(--color-border, #334155)' }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #94a3b8)' }}>
            {applyFilters(scoredResources, filters).length}/{scoredResources.length}
          </span>
          <button
            onClick={handleClearAll}
            aria-label="Clear all filters"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary, #3b82f6)',
              cursor: 'pointer',
              fontSize: '0.75rem',
              padding: 0,
            }}
          >
            Clear
          </button>
        </>
      )}
    </div>
  );
}
