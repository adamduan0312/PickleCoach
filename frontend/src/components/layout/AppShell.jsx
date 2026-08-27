import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { homePathFor } from '../../auth/paths.js';
import { hasAdminRole, hasCoachRole, hasStudentRole } from '../../domain/userReadiness.js';
import { notificationsApi } from '../../api/index.js';
import { authApi } from '../../api/index.js';
import { Avatar } from '../ui/Avatar.jsx';

function navClass({ isActive }) {
  return isActive ? 'active' : undefined;
}

export function AppShell({ children }) {
  const { user, mode, setMode, logout, readiness, refreshProfile } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const menuRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  const roles = user?.roles || [];
  const student = hasStudentRole(roles);
  const coach = hasCoachRole(roles);
  const admin = hasAdminRole(roles);

  // Keep email_verified_at (and the verify banner) in sync with the backend.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshProfile();
      } catch {
        /* ignore — RequireAuth / unauthorized handler will clear session if needed */
      }
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [refreshProfile]);

  // If they verified in another tab, drop the banner when they come back.
  useEffect(() => {
    if (user?.email_verified_at) return undefined;
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      refreshProfile().catch(() => {});
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user?.email_verified_at, refreshProfile]);

  function closeOverlays() {
    setDrawer(false);
    setMenuOpen(false);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data } = await notificationsApi.unreadCount();
        if (!cancelled) setUnread(Number(data?.count) || 0);
      } catch {
        /* ignore */
      }
    }
    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [location.pathname]);

  useEffect(() => {
    function onDoc(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const links = [];
  if (mode === 'admin' && admin) {
    links.push({ to: '/admin', label: 'Admin' });
    links.push({ to: '/admin/users', label: 'Users' });
    links.push({ to: '/admin/bookings', label: 'Bookings' });
    links.push({ to: '/admin/disputes', label: 'Disputes' });
  } else if (mode === 'coach' && coach) {
    links.push({ to: '/coach', label: 'Dashboard' });
    links.push({ to: '/coach/bookings', label: 'Bookings' });
    links.push({ to: '/coach/lessons', label: 'Lessons' });
    links.push({ to: '/coach/availability', label: 'Availability' });
    links.push({ to: '/coach/courts', label: 'Courts' });
    if (student) links.push({ to: '/discover', label: 'Find a coach' });
  } else {
    links.push({ to: '/dashboard', label: 'Dashboard' });
    links.push({ to: '/discover', label: 'Find a coach' });
    links.push({ to: '/bookings', label: 'My bookings' });
  }
  links.push({ to: '/messages', label: 'Messages' });
  links.push({ to: '/notifications', label: 'Notifications' });

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  function switchMode(next) {
    setMode(next);
    setDrawer(false);
    setMenuOpen(false);
    if (next === 'student') navigate('/dashboard');
    else if (next === 'coach') navigate('/coach');
    else if (next === 'admin') navigate('/admin');
  }

  const showModeSwitch = (student && coach) || admin;
  const showCoachProfileLink = mode === 'coach' && coach && readiness.coachUiPhase !== 'hidden';

  return (
    <div>
      {!user?.email_verified_at ? <VerifyBanner /> : null}
      <header className="app-header">
        <Link className="brand" to={homePathFor(user, mode)}>
          <span className="brand-mark">P</span>
          PickleCoach
        </Link>
        <nav className="nav-links">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={navClass} end={l.to === '/admin' || l.to === '/coach' || l.to === '/dashboard'} onClick={closeOverlays}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          {showModeSwitch ? (
            <div className="mode-switch mode-switch-header" aria-label="Experience mode" title="Switches which menu you see. It does not change your roles.">
              {student ? (
                <button type="button" className={mode === 'student' ? 'active' : ''} onClick={() => switchMode('student')}>
                  Student
                </button>
              ) : null}
              {coach ? (
                <button type="button" className={mode === 'coach' ? 'active' : ''} onClick={() => switchMode('coach')}>
                  Coach
                </button>
              ) : null}
              {admin ? (
                <button type="button" className={mode === 'admin' ? 'active' : ''} onClick={() => switchMode('admin')}>
                  Admin
                </button>
              ) : null}
            </div>
          ) : null}
          <Link to="/notifications" className="icon-btn" aria-label="Notifications">
            🔔
            {unread > 0 ? <span className="count">{unread > 99 ? '99+' : unread}</span> : null}
          </Link>
          <div className="menu" ref={menuRef}>
            <button type="button" className="icon-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Account menu">
              <Avatar name={user?.full_name} src={user?.avatar_url} />
            </button>
            {menuOpen ? (
              <div className="menu-panel">
                <div className="muted small" style={{ padding: '0.35rem 0.65rem' }}>
                  {user?.full_name}
                  <div>{user?.email}</div>
                </div>
                <Link to="/settings" onClick={closeOverlays}>Settings</Link>
                {showCoachProfileLink ? (
                  <Link to="/coach/profile" onClick={closeOverlays}>Coach profile</Link>
                ) : null}
                <button type="button" onClick={handleLogout}>Log out</button>
              </div>
            ) : null}
          </div>
          <button type="button" className="icon-btn hamburger" onClick={() => setDrawer(true)} aria-label="Open menu">
            ☰
          </button>
        </div>
      </header>
      {drawer ? (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <aside className="drawer" aria-label="Mobile navigation">
            <div className="spread">
              <strong>Menu</strong>
              <button type="button" className="btn ghost" onClick={() => setDrawer(false)}>Close</button>
            </div>
            {showModeSwitch ? (
              <div className="mode-switch mode-switch-drawer" aria-label="Experience mode" title="Switches which menu you see. It does not change your roles.">
                {student ? (
                  <button type="button" className={mode === 'student' ? 'active' : ''} onClick={() => switchMode('student')}>
                    Student
                  </button>
                ) : null}
                {coach ? (
                  <button type="button" className={mode === 'coach' ? 'active' : ''} onClick={() => switchMode('coach')}>
                    Coach
                  </button>
                ) : null}
                {admin ? (
                  <button type="button" className={mode === 'admin' ? 'active' : ''} onClick={() => switchMode('admin')}>
                    Admin
                  </button>
                ) : null}
              </div>
            ) : null}
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} onClick={() => setDrawer(false)}>
                {l.label}
              </NavLink>
            ))}
            <Link to="/settings" onClick={() => setDrawer(false)}>Settings</Link>
            {showCoachProfileLink ? (
              <Link to="/coach/profile" onClick={() => setDrawer(false)}>Coach profile</Link>
            ) : null}
            <button type="button" className="btn secondary" onClick={handleLogout}>Log out</button>
          </aside>
        </>
      ) : null}
      <main>{children}</main>
    </div>
  );
}

function VerifyBanner() {
  const { refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  async function resend() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await authApi.requestEmailVerification();
      setMsg(res.message);
      // Backend may report already verified — refresh so the banner can disappear.
      if (/already verified/i.test(res.message || '')) {
        try { await refreshProfile(); } catch { /* ignore */ }
      }
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="notice-banner">
      Please verify your email to book lessons and manage payments.{' '}
      <button type="button" className="linkish" onClick={resend} disabled={busy} style={{ background: 'none', border: 0, fontWeight: 700, cursor: 'pointer', color: 'inherit' }}>
        {busy ? 'Sending…' : 'Resend verification email'}
      </button>
      {msg ? <span> — {msg}</span> : null}
    </div>
  );
}
