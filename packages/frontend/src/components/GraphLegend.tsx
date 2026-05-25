/**
 * Floating legend overlay for the dependency graph.
 * Shows risk category colors, node sizes, and edge direction.
 */
export function GraphLegend() {
  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '1rem',
    left: '1rem',
    background: 'rgba(15, 23, 42, 0.85)',
    border: '1px solid rgba(51, 65, 85, 0.7)',
    borderRadius: '0.5rem',
    padding: '0.75rem 1rem',
    fontSize: '0.6875rem',
    color: '#94a3b8',
    zIndex: 10,
    backdropFilter: 'blur(4px)',
    minWidth: '160px',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '0.625rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#64748b',
    marginBottom: '0.5rem',
    fontWeight: 600,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.3rem',
  };

  const circleStyle = (color: string, size: number = 10): React.CSSProperties => ({
    width: size,
    height: size,
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  });

  const sizeRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    marginBottom: '0.3rem',
  };

  return (
    <div style={containerStyle} aria-label="Graph legend">
      <div style={titleStyle}>Legend</div>

      {/* Risk categories */}
      <div style={rowStyle}>
        <span style={{ ...circleStyle('#3b82f6', 10), border: '2px solid #2b6cb0' }} />
        <span>Direct Change (source)</span>
      </div>
      <div style={rowStyle}>
        <span style={circleStyle('#e53e3e')} />
        <span>Critical (75–100)</span>
      </div>
      <div style={rowStyle}>
        <span style={circleStyle('#dd6b20')} />
        <span>High (50–74)</span>
      </div>
      <div style={rowStyle}>
        <span style={circleStyle('#d69e2e')} />
        <span>Medium (25–49)</span>
      </div>
      <div style={rowStyle}>
        <span style={circleStyle('#38a169')} />
        <span>Low (0–24)</span>
      </div>

      {/* Separator */}
      <div style={{ borderTop: '1px solid rgba(51, 65, 85, 0.5)', margin: '0.5rem 0' }} />

      {/* Size legend */}
      <div style={titleStyle}>Size = Score</div>
      <div style={sizeRowStyle}>
        <span style={circleStyle('#64748b', 8)} />
        <span style={circleStyle('#64748b', 12)} />
        <span style={circleStyle('#64748b', 16)} />
        <span style={{ marginLeft: '0.25rem' }}>Low → High</span>
      </div>

      {/* Edge direction */}
      <div style={{ borderTop: '1px solid rgba(51, 65, 85, 0.5)', margin: '0.5rem 0' }} />
      <div style={rowStyle}>
        <svg width="24" height="10" style={{ flexShrink: 0 }}>
          <line x1="0" y1="5" x2="18" y2="5" stroke="#a0aec0" strokeWidth="1.5" strokeDasharray="3,2" />
          <polygon points="18,2 24,5 18,8" fill="#a0aec0" />
        </svg>
        <span>Dependency direction</span>
      </div>
    </div>
  );
}
