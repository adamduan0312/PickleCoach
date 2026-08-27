import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../../components/layout/AuthLayout.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { PasswordField } from '../../components/ui/PasswordField.jsx';
import { Alert } from '../../components/ui/States.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { homePathFor } from '../../auth/paths.js';
import { detectLocalTimezone } from '../../utils/datetime.js';
import { passwordHint, validatePassword, fieldError } from '../../utils/format.js';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'student',
  });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  function update(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    const pw = validatePassword(form.password);
    if (pw.length) {
      setFieldErrors({ password: pw[0] });
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const user = await register({
        ...form,
        timezone: detectLocalTimezone(),
      });
      navigate(homePathFor(user, form.role), { replace: true });
    } catch (err) {
      setError(err.message);
      setFieldErrors({
        email: fieldError(err, 'email'),
        password: fieldError(err, 'password'),
        full_name: fieldError(err, 'full_name'),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create your account" subtitle="Join as a student or a coach.">
      <form className="stack" onSubmit={onSubmit}>
        <Alert tone="error">{error}</Alert>
        <FormField label="Full name" name="full_name" value={form.full_name} onChange={update} error={fieldErrors.full_name} required autoComplete="name" />
        <FormField label="Email" name="email" type="email" value={form.email} onChange={update} error={fieldErrors.email} required autoComplete="email" />
        <PasswordField label="Password" name="password" value={form.password} onChange={update} error={fieldErrors.password} hint={passwordHint()} required autoComplete="new-password" />
        <FormField label="I am joining as" name="role" error={fieldErrors.role}>
          <select id="role" name="role" value={form.role} onChange={update}>
            <option value="student">Student</option>
            <option value="coach">Coach</option>
          </select>
        </FormField>
        <button className="btn block" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        <p className="small muted">Already have an account? <Link to="/login">Log in</Link></p>
      </form>
    </AuthLayout>
  );
}
