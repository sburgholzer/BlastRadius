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

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const RISK_COLORS: Record<RiskCategory, string> = {
    Critical: '#dc2626',
    High: '#ea580c',
    Medium: '#ca8a04',
    Low: '#16a34a',
  };

  function shortenId(id: string): string {
    // Extract the meaningful part from ARNs
    // arn:aws:rds:us-east-1:123456789012:db:prod-postgres → prod-postgres
    if (id.startsWith('arn:')) {
      const parts = id.split(':');
      const lastPart = parts.slice(5).join(':');
      return lastPart.length > 35 ? '...' + lastPart.slice(-32) : lastPart;
    }
    return id.length > 35 ? '...' + id.slice(-32) : id;
  }

  function shortenType(type: string): string {
    return type.replace('AWS::', '').replace('aws_', '');
  }

  if (resources.length === 0) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted, #94a3b8)' }}>No affected resources.</div>;
  }

  const thStyle: React.CSSProperties = {
    padding: '0.5rem 0.75rem',
    textAlign: 'left',
    fontSize: '0.6875rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--color-text-muted, #94a3b8)',
    borderBottom: '1px solid var(--color-border, #334155)',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  const tdStyle: React.CSSProperties = {
    padding: '0.5rem 0.75rem',
    fontSize: '0.8125rem',
    borderBottom: '1px solid var(--color-border, #334155)',
    whiteSpace: 'nowrap',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>Affected Resources</h2>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #94a3b8)' }}>
          {resources.length} resource{resources.length !== 1 ? 's' : ''} total • 💡 Click a row for full details
        </span>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border, #334155)', borderRadius: '0.5rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }} role="grid" aria-label="Affected resources">
          <thead>
            <tr style={{ background: 'var(--color-surface, #1e293b)' }} title="Click column headers to sort">
              <th style={thStyle} onClick={() => handleSort('impactScore')}>Score{getSortIndicator('impactScore')}</th>
              <th style={thStyle} onClick={() => handleSort('riskCategory')}>Risk{getSortIndicator('riskCategory')}</th>
              <th style={thStyle} onClick={() => handleSort('resourceType')}>Type{getSortIndicator('resourceType')}</th>
              <th style={thStyle} onClick={() => handleSort('resourceId')}>Resource{getSortIndicator('resourceId')}</th>
              <th style={thStyle} onClick={() => handleSort('region')}>Region{getSortIndicator('region')}</th>
              <th style={thStyle} onClick={() => handleSort('dependencyDepth')}>Depth{getSortIndicator('dependencyDepth')}</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.map((resource) => {
              const isExpanded = expandedId === resource.resourceId;
              return (
                <>
                  <tr
                    key={resource.resourceId}
                    onClick={() => setExpandedId(isExpanded ? null : resource.resourceId)}
                    style={{
                      cursor: 'pointer',
                      background: isExpanded ? 'var(--color-surface, #1e293b)' : 'transparent',
                      transition: 'background 0.1s',
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 700, color: RISK_COLORS[resource.riskCategory] }}>
                      {resource.impactScore}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: RISK_COLORS[resource.riskCategory], fontWeight: 500 }}>
                        {resource.riskCategory}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem' }}>
                      {shortenType(resource.resourceType)}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem', color: 'var(--color-text-muted, #94a3b8)' }}>
                      {shortenId(resource.resourceId)}
                    </td>
                    <td style={{ ...tdStyle, fontSize: '0.75rem' }}>{resource.region}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{resource.dependencyDepth}</td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${resource.resourceId}-detail`}>
                      <td colSpan={6} style={{ padding: '0.75rem 1rem', background: 'var(--color-surface, #1e293b)', borderBottom: '1px solid var(--color-border, #334155)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 2rem', fontSize: '0.75rem' }}>
                          <div>
                            <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Full Resource ID:</span>
                            <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.6875rem', wordBreak: 'break-all', marginTop: '0.125rem' }}>
                              {resource.resourceId}
                            </div>
                          </div>
                          <div>
                            <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Account:</span>
                            <div style={{ marginTop: '0.125rem' }}>{resource.accountId}</div>
                          </div>
                          <div style={{ gridColumn: '1 / -1' }}>
                            <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Dependency Chain:</span>
                            <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.6875rem', marginTop: '0.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
                              {resource.dependencyChain.map((id, idx) => (
                                <span key={`${id}-${idx}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <span style={{
                                    background: idx === resource.dependencyChain.length - 1 ? `${RISK_COLORS[resource.riskCategory]}20` : 'var(--color-bg, #0f172a)',
                                    border: `1px solid ${idx === resource.dependencyChain.length - 1 ? RISK_COLORS[resource.riskCategory] : 'var(--color-border, #334155)'}`,
                                    borderRadius: '0.25rem',
                                    padding: '0.125rem 0.375rem',
                                    fontSize: '0.625rem',
                                  }}>
                                    {id.length > 30 ? '...' + id.slice(-27) : id}
                                  </span>
                                  {idx < resource.dependencyChain.length - 1 && (
                                    <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>→</span>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div>
                            <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Criticality:</span>
                            <div style={{ marginTop: '0.125rem' }}>{resource.criticalityClassification}</div>
                          </div>
                          <div>
                            <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Change Severity:</span>
                            <div style={{ marginTop: '0.125rem' }}>{resource.changeTypeSeverity}/100</div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.8125rem' }}>
          <button onClick={() => setCurrentPage(1)} disabled={safeCurrentPage === 1} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted, #94a3b8)', cursor: 'pointer' }}>«</button>
          <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safeCurrentPage === 1} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted, #94a3b8)', cursor: 'pointer' }}>‹</button>
          <span style={{ color: 'var(--color-text-muted, #94a3b8)' }}>Page {safeCurrentPage} of {totalPages}</span>
          <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safeCurrentPage === totalPages} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted, #94a3b8)', cursor: 'pointer' }}>›</button>
          <button onClick={() => setCurrentPage(totalPages)} disabled={safeCurrentPage === totalPages} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted, #94a3b8)', cursor: 'pointer' }}>»</button>
        </div>
      )}
    </div>
  );
}
