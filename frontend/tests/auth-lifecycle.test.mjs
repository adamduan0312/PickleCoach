/**
 * Auth lifecycle: mode after role loss, protected-path access, and FE wiring
 * so a previously valid session cannot keep removed capabilities in the UI.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  homePathFor,
  inferMode,
  pathMatchesMode,
  postLoginPath,
  userCanAccessPath,
} from '../src/auth/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('inferMode after role changes', () => {
  it('keeps preferred coach mode only while the coach role remains', () => {
    assert.equal(inferMode({ roles: ['student', 'coach'] }, 'coach'), 'coach');
    assert.equal(inferMode({ roles: ['student'] }, 'coach'), 'student');
  });

  it('drops admin mode when the admin role is removed', () => {
    assert.equal(inferMode({ roles: ['admin', 'student'] }, 'admin'), 'admin');
    assert.equal(inferMode({ roles: ['student'] }, 'admin'), 'student');
  });
});

describe('protected paths after authorization shrinks', () => {
  it('blocks coach/admin URLs when those roles are gone', () => {
    const studentOnly = { roles: ['student'] };
    assert.equal(userCanAccessPath(studentOnly, '/coach'), false);
    assert.equal(userCanAccessPath(studentOnly, '/coach/lessons'), false);
    assert.equal(userCanAccessPath(studentOnly, '/admin'), false);
    assert.equal(userCanAccessPath(studentOnly, '/dashboard'), true);
    assert.equal(userCanAccessPath(studentOnly, '/bookings/99'), true);
  });

  it('sends post-login to mode home instead of a now-forbidden return URL', () => {
    const user = { roles: ['student'] };
    assert.equal(postLoginPath(user, 'student', '/coach'), '/dashboard');
    assert.equal(postLoginPath(user, 'student', '/admin/users'), '/dashboard');
  });

  it('does not treat a student-mode session as matching coach URLs', () => {
    assert.equal(pathMatchesMode('/coach', 'student'), false);
    assert.equal(pathMatchesMode('/dashboard', 'student'), true);
  });

  it('homePathFor follows remaining roles after preferred mode is invalid', () => {
    assert.equal(homePathFor({ roles: ['student'] }, 'coach'), '/dashboard');
    assert.equal(homePathFor({ roles: ['coach'] }, 'admin'), '/coach');
  });
});

describe('session wiring contracts', () => {
  const shellSrc = readFileSync(join(__dirname, '../src/components/layout/AppShell.jsx'), 'utf8');
  const guardsSrc = readFileSync(join(__dirname, '../src/auth/guards.jsx'), 'utf8');
  const clientSrc = readFileSync(join(__dirname, '../src/api/client.js'), 'utf8');
  const verifySrc = readFileSync(join(__dirname, '../src/pages/auth/VerifyEmailPage.jsx'), 'utf8');
  const notifSrc = readFileSync(join(__dirname, '../src/pages/notifications/NotificationsPage.jsx'), 'utf8');

  it('reloads profile on route change and when the tab becomes visible', () => {
    assert.match(shellSrc, /location\.pathname/);
    assert.match(shellSrc, /visibilitychange/);
    assert.match(shellSrc, /refreshProfile/);
  });

  it('RequireAuth sends unauthenticated users to login; RequireRole sends missing roles to forbidden', () => {
    assert.match(guardsSrc, /to="\/login"/);
    assert.match(guardsSrc, /to="\/forbidden"/);
  });

  it('401 API responses clear the stored session', () => {
    assert.match(clientSrc, /status === 401/);
    assert.match(clientSrc, /unauthorizedHandler/);
  });

  it('email verification confirm refreshes profile so the banner can drop', () => {
    assert.match(verifySrc, /confirmEmailVerification/);
    assert.match(verifySrc, /refreshProfile/);
  });

  it('profile refresh re-infers mode so a removed role cannot keep coach/admin chrome', () => {
    const ctxSrc = readFileSync(join(__dirname, '../src/auth/AuthContext.jsx'), 'utf8');
    const refreshBlock = ctxSrc.slice(
      ctxSrc.indexOf('const refreshProfile'),
      ctxSrc.indexOf('const refreshStripeStatus'),
    );
    assert.match(refreshBlock, /inferMode/);
    assert.match(refreshBlock, /writeModeForUser/);
  });

  it('notifications feed stays in-app only', () => {
    assert.match(notifSrc, /channel === 'in_app'/);
  });
});
