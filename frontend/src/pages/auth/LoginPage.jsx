import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../../components/layout/AuthLayout.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { PasswordField } from '../../components/ui/PasswordField.jsx';
import { Alert } from '../../components/ui/States.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { clearIntentionalLogout } from '../../auth/logoutIntent.js';
import { postLoginPath, resumePathFromLoginState } from '../../auth/paths.js';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // End the logout session boundary so a later real auth bounce can resume.
    clearIntentionalLogout();
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user, mode } = await login({ email, password });
      // Only resume URL after an auth-guard bounce — not after logout / plain /login.
      const from = resumePathFromLoginState(location.state);
      navigate(postLoginPath(user, mode, from), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Log in" subtitle="Welcome back to PickleCoach.">
      <form className="stack" onSubmit={onSubmit}>
        <Alert tone="error">{error}</Alert>
        <FormField label="Email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <PasswordField label="Password" name="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        <button className="btn block" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
        <div className="spread small">
          <Link to="/forgot-password">Forgot password?</Link>
          <Link to="/register">Create an account</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
