import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { homePathFor } from '../../auth/paths.js';
import { hasAdminRole, hasCoachRole, hasStudentRole } from '../../domain/userReadiness.js';
import { bookingsNeedNavAttention } from '../../domain/bookingStatus.js';
import {
  buildPrimaryNavLinks,
  navItemAriaLabel,
  navItemShowsAttentionDot,
} from '../../domain/navAttention.js';
import {
  authApi,
  asList,
  coachesApi,
  messagesApi,
  notificationsApi,
  studentsApi,
} from '../../api/index.js';
import { Avatar } from '../ui/Avatar.jsx';

function navClass({ isActive }) {
  return isActive ? 'active' : undefined;
}

function NavAttentionLabel({ label, showDot }) {
  return (
    <span className="nav-label">
      <span>{label}</span>
      {showDot ? <span className="nav-attention-dot" aria-hidden="true" /> : null}
    </span>
  );
}

export function AppShell({ children }) {
  const { user, mode, setMode, logout, readiness, refreshProfile } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [messagesAttention, setMessagesAttention] = useState(false);
  const [bookingsAttention, setBookingsAttention] = useState(false);
  const menuRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  const roles = user?.roles || [];
  const student = hasStudentRole(roles);
  const coach = hasCoachRole(roles);
  const admin = hasAdminRole(roles);

  // Reload authorization (roles, email_verified_at) on navigation and when the tab
  // becomes visible so a session cannot keep a removed role's UI after an admin change.
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
  }, [refreshProfile, location.pathname]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      refreshProfile().catch(() => {});
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshProfile]);

  function closeOverlays() {
    setDrawer(false);
    setMenuOpen(false);
  }

  // Bell + Messages/Bookings attention — independent signals, refreshed on nav + interval.
  useEffect(() => {
    let cancelled = false;

    async function loadBell() {
      try {
        const { data } = await notificationsApi.unreadCount();
        if (!cancelled) setUnread(Number(data?.count) || 0);
      } catch {
        /* ignore */
      }
    }

    async function loadMessagesAttention() {
      try {
        const { data } = await messagesApi.unreadCount();
        if (!cancelled) setMessagesAttention((Number(data?.count) || 0) > 0);
      } catch {
        if (!cancelled) setMessagesAttention(false);
      }
    }

    async function loadBookingsAttention() {
      try {
        if (mode === 'coach' && coach) {
          // Full list: pending, awaiting_verification, and issue/dispute all need fields.
          const res = await coachesApi.myBookings();
          if (!cancelled) {
            setBookingsAttention(bookingsNeedNavAttention(asList(res.data), 'coach'));
          }
          return;
        }
        if (mode !== 'admin' && student) {
          const res = await studentsApi.myBookings();
          if (!cancelled) {
            setBookingsAttention(bookingsNeedNavAttention(asList(res.data), 'student'));
          }
          return;
        }
        if (!cancelled) setBookingsAttention(false);
      } catch {
        if (!cancelled) setBookingsAttention(false);
      }
    }

    async function loadAll() {
      await Promise.all([loadBell(), loadMessagesAttention(), loadBookingsAttention()]);
    }

    loadAll();
    const id = setInterval(loadAll, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [location.pathname, mode, coach, student]);

  useEffect(() => {
    function onDoc(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const attentionFlags = useMemo(
    () => ({ messages: messagesAttention, bookings: bookingsAttention }),
    [messagesAttention, bookingsAttention],
  );

  const links = useMemo(
    () => buildPrimaryNavLinks({ mode, student, coach, admin }),
    [mode, student, coach, admin],
  );

  async function handleLogout() {
    await logout();
    // Clean session boundary: never carry the previous user's page into the next login.
    navigate('/login', { replace: true, state: null });
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

  function renderNavLink(l, { onClick, end } = {}) {
    const showDot = navItemShowsAttentionDot(l.attention, attentionFlags);
    return (
      <NavLink
        key={l.to}
        to={l.to}
        className={navClass}
        end={end}
        onClick={onClick}
        aria-label={navItemAriaLabel(l.label, l.attention, attentionFlags)}
      >
        <NavAttentionLabel label={l.label} showDot={showDot} />
      </NavLink>
    );
  }

  return (
    <div>
      {!user?.email_verified_at ? <VerifyBanner /> : null}
      <header className="app-header">
        <Link className="brand" to={homePathFor(user, mode)}>
          <span className="brand-mark">P</span>
          PickleCoach
        </Link>
        <nav className="nav-links">
          {links.map((l) => renderNavLink(l, {
            onClick: closeOverlays,
            end: l.to === '/admin' || l.to === '/coach' || l.to === '/dashboard',
          }))}
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
          <Link
            to="/notifications"
            className="icon-btn"
            aria-label={unread > 0 ? `Notifications — ${unread} unread` : 'Notifications'}
          >
            <span className="icon-btn-glyph" aria-hidden="true">🔔</span>
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
            {links.map((l) => renderNavLink(l, { onClick: () => setDrawer(false) }))}
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
