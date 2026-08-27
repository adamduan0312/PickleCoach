import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../../components/layout/AuthLayout.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { Alert } from '../../components/ui/States.jsx';
import { authApi } from '../../api/index.js';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await authApi.forgotPassword(email);
      setMessage(res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We’ll email a reset link if that account exists.">
      <form className="stack" onSubmit={onSubmit}>
        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{message}</Alert>
        <FormField label="Email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button className="btn block" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        <Link className="small" to="/login">Back to log in</Link>
      </form>
    </AuthLayout>
  );
}
