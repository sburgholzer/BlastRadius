import { Outlet, Link } from 'react-router-dom';

export function Layout() {
  return (
    <div className="app-layout">
      <header className="app-header">
        <nav>
          <Link to="/analyses" className="nav-brand">
            Blast Radius Visualizer
          </Link>
          <ul className="nav-links">
            <li>
              <Link to="/analyses">Analyses</Link>
            </li>
            <li>
              <Link to="/submit">New Analysis</Link>
            </li>
          </ul>
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
