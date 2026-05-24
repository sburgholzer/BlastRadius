import { useMemo, useState } from 'react';
import type { ScoredResource, RiskCategory } from '../api/types';

export const PAGE_SIZE = 50;

export type SortField =
  | 'impactScore'
  | 'resourceId'
  | 'resourceType'
  | 'riskCategory'
  | 'region'
  | 'dependencyDepth';

export type SortDirection = 'asc' | 'desc';

const RISK_CATEGORY_ORDER: Record<RiskCategory, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

/**
 * Sorts resources by the given field and direction.
 * Default sort is by impactScore descending.
 */
export function sortResources(
  resources: ScoredResource[],
  field: SortField = 'impactScore',
  direction: SortDirection = 'desc',
): ScoredResource[] {
  return [...resources].sort((a, b) => {
    let comparison = 0;

    switch (field) {
      case 'impactScore':
        comparison = a.impactScore - b.impactScore;
        break;
      case 'resourceId':
        comparison = a.resourceId.localeCompare(b.resourceId);
        break;
      case 'resourceType':
        comparison = a.resourceType.localeCompare(b.resourceType);
        break;
      case 'riskCategory':
        comparison =
          RISK_CATEGORY_ORDER[a.riskCategory] -
          RISK_CATEGORY_ORDER[b.riskCategory];
        break;
      case 'region':
        comparison = a.region.localeCompare(b.region);
        break;
      case 'dependencyDepth':
        comparison = a.dependencyDepth - b.dependencyDepth;
        break;
    }

    return direction === 'asc' ? comparison : -comparison;
  });
}

/**
 * Returns a page of resources from the sorted list.
 * Pages are 1-indexed. Returns up to PAGE_SIZE items.
 */
export function paginateResources(
  resources: ScoredResource[],
  page: number,
): ScoredResource[] {
  const totalPages = Math.max(1, Math.ceil(resources.length / PAGE_SIZE));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * PAGE_SIZE;
  return resources.slice(start, start + PAGE_SIZE);
}

export interface ResourceTableProps {
  resources: ScoredResource[];
}

export function ResourceTable({ resources }: ResourceTableProps) {
  const [sortField, setSortField] = useState<SortField>('impactScore');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);

  const sortedResources = useMemo(
    () => sortResources(resources, sortField, sortDirection),
    [resources, sortField, sortDirection],
  );

  const totalPages = Math.max(1, Math.ceil(sortedResources.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedItems = useMemo(
    () => paginateResources(sortedResources, safeCurrentPage),
    [sortedResources, safeCurrentPage],
  );

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'impactScore' ? 'desc' : 'asc');
    }
    setCurrentPage(1);
  }

  function getSortIndicator(field: SortField): string {
    if (field !== sortField) return '';
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  }

  function riskCategoryClass(category: RiskCategory): string {
    switch (category) {
      case 'Critical':
        return 'risk-critical';
      case 'High':
        return 'risk-high';
      case 'Medium':
        return 'risk-medium';
      case 'Low':
        return 'risk-low';
    }
  }

  if (resources.length === 0) {
    return <div className="resource-table-empty">No affected resources.</div>;
  }

  return (
    <div className="resource-table-container">
      <div className="resource-table-header">
        <h2>Affected Resources</h2>
        <span className="resource-table-count">
          {resources.length} resource{resources.length !== 1 ? 's' : ''} total
        </span>
      </div>

      <table className="resource-table" role="grid" aria-label="Affected resources sorted by impact score">
        <thead>
          <tr>
            <th
              onClick={() => handleSort('impactScore')}
              aria-sort={
                sortField === 'impactScore'
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              }
              className="sortable"
            >
              Impact Score{getSortIndicator('impactScore')}
            </th>
            <th
              onClick={() => handleSort('riskCategory')}
              aria-sort={
                sortField === 'riskCategory'
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              }
              className="sortable"
            >
              Risk Category{getSortIndicator('riskCategory')}
            </th>
            <th
              onClick={() => handleSort('resourceType')}
              aria-sort={
                sortField === 'resourceType'
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              }
              className="sortable"
            >
              Resource Type{getSortIndicator('resourceType')}
            </th>
            <th
              onClick={() => handleSort('resourceId')}
              aria-sort={
                sortField === 'resourceId'
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              }
              className="sortable"
            >
              Resource ID{getSortIndicator('resourceId')}
            </th>
            <th
              onClick={() => handleSort('region')}
              aria-sort={
                sortField === 'region'
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              }
              className="sortable"
            >
              Region{getSortIndicator('region')}
            </th>
            <th
              onClick={() => handleSort('dependencyDepth')}
              aria-sort={
                sortField === 'dependencyDepth'
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              }
              className="sortable"
            >
              Depth{getSortIndicator('dependencyDepth')}
            </th>
          </tr>
        </thead>
        <tbody>
          {paginatedItems.map((resource) => (
            <tr key={`${resource.resourceId}-${resource.accountId}`}>
              <td className="score-cell">{resource.impactScore}</td>
              <td>
                <span className={`risk-badge ${riskCategoryClass(resource.riskCategory)}`}>
                  {resource.riskCategory}
                </span>
              </td>
              <td>{resource.resourceType}</td>
              <td className="resource-id-cell" title={resource.resourceId}>
                {resource.resourceId}
              </td>
              <td>{resource.region}</td>
              <td>{resource.dependencyDepth}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <nav className="resource-table-pagination" aria-label="Table pagination">
          <button
            onClick={() => setCurrentPage(1)}
            disabled={safeCurrentPage === 1}
            aria-label="First page"
          >
            «
          </button>
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safeCurrentPage === 1}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className="pagination-info">
            Page {safeCurrentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safeCurrentPage === totalPages}
            aria-label="Next page"
          >
            ›
          </button>
          <button
            onClick={() => setCurrentPage(totalPages)}
            disabled={safeCurrentPage === totalPages}
            aria-label="Last page"
          >
            »
          </button>
        </nav>
      )}
    </div>
  );
}
