/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, coachesApi, onUnauthorized, setStoredToken, getStoredToken, clearStoredToken } from '../api/index.js';
import { computeCoachReadiness, hasCoachRole } from '../domain/userReadiness.js';
import { inferMode } from './paths.js';
import { detectLocalTimezone } from '../utils/datetime.js';

const AuthContext = createContext(null);
/** Legacy single-slot key — cleared on logout; do not use as a fallback. */
const MODE_KEY = 'pc.mode';
const MODE_BY_USER_KEY = 'pc.mode.byUser';
/** One-time wipe of modes contaminated by the old global `pc.mode` fallback. */
const MODE_MIGRATION_KEY = 'pc.mode.migration';
const MODE_MIGRATION_VERSION = '2';

function readModeByUserMap() {
  try {
    const raw = localStorage.getItem(MODE_BY_USER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeModeByUserMap(map) {
  try {
    localStorage.setItem(MODE_BY_USER_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Drop legacy global mode and once-reset per-user map poisoned by it. */
function migrateModeStorage() {
  try {
    localStorage.removeItem(MODE_KEY);
    if (localStorage.getItem(MODE_MIGRATION_KEY) === MODE_MIGRATION_VERSION) return;
    localStorage.removeItem(MODE_BY_USER_KEY);
    localStorage.setItem(MODE_MIGRATION_KEY, MODE_MIGRATION_VERSION);
  } catch {
    /* ignore */
  }
}

migrateModeStorage();

/** Last experience mode for this account (student | coach | admin). */
function readModeForUser(userId) {
  if (userId == null) return null;
  const map = readModeByUserMap();
  return map[String(userId)] || null;
}

function writeModeForUser(userId, mode) {
  if (userId == null || !mode) return;
  const map = readModeByUserMap();
  map[String(userId)] = mode;
  writeModeByUserMap(map);
}

function clearLegacyGlobalMode() {
  try {
    localStorage.removeItem(MODE_KEY);
  } catch {
    /* ignore */
  }
}

function resolveModeForUser(user) {
  if (!user) return null;
  return inferMode(user, readModeForUser(user.id));
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getStoredToken());
  const [user, setUser] = useState(null);
  const [stripeStatus, setStripeStatus] = useState(null);
  const [mode, setModeState] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(Boolean(getStoredToken()));
  const [authError, setAuthError] = useState(null);

  const clearSession = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setUser(null);
    setStripeStatus(null);
    // Keep per-user mode in storage so the next login for that account restores it.
    // Clear the legacy global key so the next account cannot inherit this session's mode.
    clearLegacyGlobalMode();
    setModeState(null);
  }, []);

  const applySession = useCallback(async (nextToken, sessionUser) => {
    setStoredToken(nextToken);
    setToken(nextToken);
    if (sessionUser?.id && !sessionUser.coachProfile) {
      const profile = await authApi.getProfile();
      setUser(profile.data);
      const nextMode = resolveModeForUser(profile.data);
      setModeState(nextMode);
      writeModeForUser(profile.data.id, nextMode);
      return profile.data;
    }
    if (sessionUser) {
      setUser(sessionUser);
      const nextMode = resolveModeForUser(sessionUser);
      setModeState(nextMode);
      writeModeForUser(sessionUser.id, nextMode);
    }
    return sessionUser;
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data } = await authApi.getProfile();
    setUser(data);
    setModeState((prev) => {
      const next = inferMode(data, prev);
      writeModeForUser(data.id, next);
      return next;
    });
    return data;
  }, []);

  const refreshStripeStatus = useCallback(async () => {
    if (!hasCoachRole(user?.roles)) {
      setStripeStatus(null);
      return null;
    }
    try {
      const { data } = await coachesApi.stripeStatus();
      setStripeStatus(data);
      return data;
    } catch {
      setStripeStatus(null);
      return null;
    }
  }, [user?.roles]);

  useEffect(() => {
    onUnauthorized(() => {
      clearSession();
    });
  }, [clearSession]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const existing = getStoredToken();
      if (!existing) {
        setBootstrapping(false);
        return;
      }
      try {
        const { data } = await authApi.getProfile({ ignoreUnauthorized: true });
        if (cancelled) return;
        setUser(data);
        const nextMode = resolveModeForUser(data);
        setModeState(nextMode);
        writeModeForUser(data.id, nextMode);
      } catch (err) {
        if (cancelled) return;
        if (err.status === 401) {
          try {
            const refreshed = await authApi.refresh(existing);
            if (cancelled) return;
            await applySession(refreshed.data.token, refreshed.data.user);
            const profile = await authApi.getProfile({ ignoreUnauthorized: true });
            if (cancelled) return;
            setUser(profile.data);
          } catch {
            clearSession();
          }
        } else {
          setAuthError(err.message);
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [applySession, clearSession]);

  useEffect(() => {
    if (user && hasCoachRole(user.roles)) {
      refreshStripeStatus();
    }
  }, [user, refreshStripeStatus]);

  useEffect(() => {
    if (user?.id && mode) writeModeForUser(user.id, mode);
  }, [user?.id, mode]);

  const login = useCallback(async ({ email, password }) => {
    const { data } = await authApi.login({ email, password });
    const profile = await applySession(data.token, data.user);
    try {
      const full = await authApi.getProfile();
      setUser(full.data);
      const nextMode = resolveModeForUser(full.data);
      setModeState(nextMode);
      writeModeForUser(full.data.id, nextMode);
      return { user: full.data, mode: nextMode };
    } catch {
      const nextMode = resolveModeForUser(profile);
      return { user: profile, mode: nextMode };
    }
  }, [applySession]);

  const register = useCallback(async (body) => {
    const timezone = body.timezone || detectLocalTimezone();
    const { data } = await authApi.register({ ...body, timezone });
    await applySession(data.token, data.user);
    try {
      const full = await authApi.getProfile();
      setUser(full.data);
      const nextMode = body.role === 'coach' ? 'coach' : inferMode(full.data, body.role);
      setModeState(nextMode);
      writeModeForUser(full.data.id, nextMode);
      return full.data;
    } catch {
      const nextMode = body.role === 'coach' ? 'coach' : 'student';
      setModeState(nextMode);
      if (data.user?.id) writeModeForUser(data.user.id, nextMode);
      return data.user;
    }
  }, [applySession]);

  const logout = useCallback(async () => {
    try {
      if (getStoredToken()) await authApi.logout();
    } catch {
      /* still clear locally */
    }
    clearSession();
  }, [clearSession]);

  const setMode = useCallback((next) => {
    setModeState(next);
    if (user?.id) writeModeForUser(user.id, next);
  }, [user?.id]);

  const readiness = useMemo(
    () => computeCoachReadiness(user, stripeStatus),
    [user, stripeStatus],
  );

  const resolvedMode = inferMode(user, mode);

  const value = useMemo(
    () => ({
      token,
      user,
      mode: resolvedMode,
      setMode,
      bootstrapping,
      authError,
      stripeStatus,
      readiness,
      isAuthenticated: Boolean(token && user),
      login,
      register,
      logout,
      refreshProfile,
      refreshStripeStatus,
      applySession,
    }),
    [
      token,
      user,
      resolvedMode,
      setMode,
      bootstrapping,
      authError,
      stripeStatus,
      readiness,
      login,
      register,
      logout,
      refreshProfile,
      refreshStripeStatus,
      applySession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
