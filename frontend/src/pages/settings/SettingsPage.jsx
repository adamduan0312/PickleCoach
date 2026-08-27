import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { authApi } from '../../api/index.js';
import { FormField } from '../../components/ui/FormField.jsx';
import { Alert } from '../../components/ui/States.jsx';
import { passwordHint, validatePassword } from '../../utils/format.js';
import { detectLocalTimezone } from '../../utils/datetime.js';
import { hasCoachRole, hasStudentRole } from '../../domain/userReadiness.js';
import { Link } from 'react-router-dom';

export function SettingsPage() {
  const { user, mode, refreshProfile, applySession, readiness } = useAuth();
  const [profile, setProfile] = useState({
    full_name: user?.full_name || '',
    phone: user?.phone || '',
    timezone: user?.timezone || detectLocalTimezone(),
    avatar_url: user?.avatar_url || '',
  });
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [emailForm, setEmailForm] = useState({ new_email: '', password: '' });
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function saveProfile(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.updateProfile(profile);
      await refreshProfile();
      setMessage('Profile updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    const errs = validatePassword(pw.new_password);
    if (errs.length) {
      setError(errs[0]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.changePassword(pw);
      if (res.data?.token) await applySession(res.data.token, res.data.user);
      setMessage(res.message || 'Password changed.');
      setPw({ current_password: '', new_password: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function requestEmail(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.requestEmailChange(emailForm);
      setMessage(res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addRole(role) {
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.addRole(role);
      if (res.data?.token) await applySession(res.data.token, res.data.user);
      await refreshProfile();
      setMessage(res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeRole(role) {
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.removeRole(role);
      if (res.data?.token) await applySession(res.data.token, res.data.user);
      await refreshProfile();
      setMessage(res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const locked = user?.role_state?.locked;
  const isAdmin = (user?.roles || []).includes('admin');
  const isStudent = hasStudentRole(user?.roles);
  const isCoach = hasCoachRole(user?.roles);
  // Must keep at least one marketplace role; dual-role users can drop either (admins use admin tools).
  const canRemoveStudent = !isAdmin && isStudent && isCoach;
  const canRemoveCoach = !isAdmin && isCoach && isStudent;

  return (
    <div className="page">
      <h1>Account settings</h1>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{message}</Alert>
      <div className="grid-2">
        <form className="card stack" onSubmit={saveProfile}>
          <h2>Profile</h2>
          <FormField label="Name" name="full_name" value={profile.full_name} onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))} />
          <FormField label="Phone" name="phone" value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} />
          <FormField label="Time zone" name="timezone" value={profile.timezone} onChange={(e) => setProfile((p) => ({ ...p, timezone: e.target.value }))} hint="IANA name such as America/New_York. Detected at signup; change it here if you move or travel." />
          <FormField label="Avatar URL" name="avatar_url" value={profile.avatar_url} onChange={(e) => setProfile((p) => ({ ...p, avatar_url: e.target.value }))} />
          <div className="small muted">Email: {user?.email} {user?.email_verified_at ? '(verified)' : '(not verified)'}</div>
          <button className="btn" type="submit" disabled={busy}>Save profile</button>
        </form>
        <form className="card stack" onSubmit={changePassword}>
          <h2>Change password</h2>
          <FormField label="Current password" name="current_password" type="password" value={pw.current_password} onChange={(e) => setPw((p) => ({ ...p, current_password: e.target.value }))} required />
          <FormField label="New password" name="new_password" type="password" value={pw.new_password} onChange={(e) => setPw((p) => ({ ...p, new_password: e.target.value }))} hint={passwordHint()} required />
          <button className="btn secondary" type="submit" disabled={busy}>Update password</button>
        </form>
        <form className="card stack" onSubmit={requestEmail}>
          <h2>Change email</h2>
          <FormField label="New email" name="new_email" type="email" value={emailForm.new_email} onChange={(e) => setEmailForm((p) => ({ ...p, new_email: e.target.value }))} required />
          <FormField label="Current password" name="password" type="password" value={emailForm.password} onChange={(e) => setEmailForm((p) => ({ ...p, password: e.target.value }))} required />
          <button className="btn secondary" type="submit" disabled={busy}>Send confirmation</button>
        </form>
        <div className="card stack">
          <h2>Roles</h2>
          <p className="small muted">
            Roles control what you can do (book as a student, teach as a coach). The Student/Coach switch in the header only changes which menu you see — it does not add or remove a role.
          </p>
          <p className="small muted">Your roles: {(user?.roles || []).join(', ') || 'none'}</p>
          <p className="small muted">
            Removing a role does not delete past bookings or history. Existing bookings stay available to both participants.
          </p>
          <p className="small muted">
            Removing a role stops new activity for that role. Existing bookings, payments, and coach profile data are kept.
          </p>
          {!isStudent && !locked ? <button className="btn secondary" type="button" disabled={busy} onClick={() => addRole('student')}>Add student role</button> : null}
          {!isCoach && !locked ? <button className="btn secondary" type="button" disabled={busy} onClick={() => addRole('coach')}>Add coach role</button> : null}
          {canRemoveStudent ? (
            <button className="btn ghost" type="button" disabled={busy} onClick={() => removeRole('student')}>
              Remove student role
            </button>
          ) : null}
          {canRemoveCoach ? (
            <button className="btn ghost" type="button" disabled={busy} onClick={() => removeRole('coach')}>
              Remove coach role
            </button>
          ) : null}
          {locked ? <p className="small muted">An administrator has restricted which roles you can add.</p> : null}
          {mode === 'coach' && isCoach && readiness.coachUiPhase !== 'hidden' ? (
            <Link to="/coach/profile">Edit coach marketplace profile</Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
