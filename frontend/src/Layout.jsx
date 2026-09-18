import { Link, useLocation } from 'react-router-dom';

function Logo() {
  return <div className="brand-mark" aria-hidden="true"><span /><span /></div>;
}

export default function Layout({ children }) {
  const location = useLocation();
  const isAuthPage = location.pathname === '/auth';
  const isAssetPage = location.pathname.startsWith('/assets');

  return (
    <div className="app-layout">
      <div className="grain" />
      {!isAuthPage && (
        <header className="global-navbar">
          <Link to="/assets" className="navbar-brand">
            <Logo />
            <span>Auctoz</span>
          </Link>
          <nav className="navbar-nav">
            <Link to="/assets" className={`nav-link ${isAssetPage ? 'active' : ''}`}>
              Assets
            </Link>
            {isAssetPage && (
              <Link to="/auth" className="nav-link">
                Sign In
              </Link>
            )}
          </nav>
          <div className="navbar-status">
            <span className="status-dot" />
            <span>ENGINE ONLINE</span>
          </div>
        </header>
      )}
      <main className={`main-content ${isAuthPage ? 'auth-content' : ''}`}>
        {children}
      </main>
      {!isAuthPage && (
        <footer className="global-footer">
          <span>AUCTOZ</span>
          <span className="divider">/</span>
          <span>ENGINE ONLINE</span>
        </footer>
      )}
    </div>
  );
}