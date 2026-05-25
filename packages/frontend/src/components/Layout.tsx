import { Outlet, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';

function getInitialTheme(): 'dark' | 'light' {
  try {
    const stored = localStorage.getItem('blast-radius-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage unavailable
  }
  return 'dark';
}

export function Layout() {
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem('blast-radius-theme', theme);
    } catch {
      // localStorage unavailable
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const toggleButtonStyle: React.CSSProperties = {
    background: 'none',
    border: '1px solid var(--color-border, #334155)',
    borderRadius: '0.375rem',
    padding: '0.375rem 0.625rem',
    cursor: 'pointer',
    fontSize: '1rem',
    lineHeight: 1,
    color: 'var(--color-text, #f1f5f9)',
    transition: 'background 0.15s',
  };

  return (
    <div className="app-layout">
      <header className="app-header">
        <nav>
          <Link to="/analyses" className="nav-brand">
            Blast Radius Visualizer
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <ul className="nav-links">
              <li>
                <Link to="/analyses">Analyses</Link>
              </li>
              <li>
                <Link to="/submit">New Analysis</Link>
              </li>
            </ul>
            <button
              onClick={toggleTheme}
              style={toggleButtonStyle}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
