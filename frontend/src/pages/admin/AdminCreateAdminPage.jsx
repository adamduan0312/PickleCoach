import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminApi } from '../../api/index.js';
import { Alert, ErrorState } from '../../components/ui/States.jsx';
import { AdminPageHeader } from '../../components/admin/AdminPageHeader.jsx';
import { FormField } from '../../components/ui/FormField.jsx';

/**
 * POST /api/admin/users — provision an administrator account.
 */
export function AdminCreateAdminPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = {
        full_name: fullName.trim(),
        email: email.trim(),
        password,
      };
      if (phone.trim()) body.phone = phone.trim();
      if (timezone.trim()) body.timezone = timezone.trim();
      const res = await adminApi.createAdmin(body);
      const created = res.data;
      setMessage(`Admin created: ${created?.email || email}`);
      if (created?.id) {
        navigate(`/admin/users/${created.id}`, { replace: true });
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <AdminPageHeader
        title="Create administrator"
        subtitle="Provisions a user with the admin role. This is not a student or coach signup."
        actions={<Link className="btn secondary" to="/admin/users">Back to users</Link>}
      />

      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <ErrorState error={error} /> : null}

      <form className="card stack admin-section-card" onSubmit={submit}>
        <FormField label="Full name" name="full_name" required>
          <input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} required disabled={busy} />
        </FormField>
        <FormField label="Email" name="email" required>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={busy} />
        </FormField>
        <FormField label="Temporary password" name="password" required>
          <>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={busy}
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
            />
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              At least 10 characters, with one lowercase, one uppercase, and one number (same policy as registration).
            </p>
          </>
        </FormField>
        <FormField label="Phone (optional)" name="phone">
          <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
        </FormField>
        <FormField label="Timezone" name="timezone">
          <input id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={busy} />
        </FormField>
        <button className="btn" type="submit" disabled={busy}>Create admin user</button>
      </form>
    </div>
  );
}
