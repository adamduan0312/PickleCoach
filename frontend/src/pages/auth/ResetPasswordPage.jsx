import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../../components/layout/AuthLayout.jsx';
import { PasswordField } from '../../components/ui/PasswordField.jsx';
import { Alert } from '../../components/ui/States.jsx';
import { authApi } from '../../api/index.js';
import { passwordHint, validatePassword } from '../../utils/format.js';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    const pw = validatePassword(password);
    if (pw.length) {
      setError(pw[0]);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!token) {
      setError('This reset link is missing a token. Request a new one.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.resetPassword({ token, password });
      setMessage(res.message || 'Password reset successfully.');
      setTimeout(() => navigate('/login'), 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="Paste came from your email reset link.">
      <form className="stack" onSubmit={onSubmit}>
        {!token ? <Alert tone="error">No reset token found in the URL. Open the link from your email, or request a new one.</Alert> : null}
        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{message}</Alert>
        <PasswordField label="New password" name="password" value={password} onChange={(e) => setPassword(e.target.value)} hint={passwordHint()} required autoComplete="new-password" />
        <PasswordField label="Confirm password" name="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        <button className="btn block" type="submit" disabled={busy || !token}>{busy ? 'Saving…' : 'Reset password'}</button>
        <Link className="small" to="/forgot-password">Request a new link</Link>
      </form>
    </AuthLayout>
  );
}
