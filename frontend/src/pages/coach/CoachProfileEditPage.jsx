import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { coachesApi } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { FormField } from '../../components/ui/FormField.jsx';
import { Alert } from '../../components/ui/States.jsx';
import { fieldError } from '../../utils/format.js';

export function CoachProfileEditPage() {
  const { user, refreshProfile, readiness } = useAuth();
  const existing = user?.coachProfile;
  const creating = !existing;
  const navigate = useNavigate();
  const [form, setForm] = useState({
    headline: existing?.headline || '',
    bio: existing?.bio || '',
    experience_years: existing?.experience_years ?? '',
    skill_rating: existing?.skill_rating ?? '',
    rating_system: existing?.rating_system || 'self',
    certifications: existing?.certifications || '',
    location: existing?.location || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  function update(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      headline: form.headline,
      bio: form.bio,
      certifications: form.certifications,
      location: form.location,
      rating_system: form.rating_system,
    };
    if (form.experience_years !== '') body.experience_years = Number(form.experience_years);
    if (form.skill_rating !== '') body.skill_rating = Number(form.skill_rating);
    try {
      if (creating) await coachesApi.createProfile(body);
      else await coachesApi.updateMyProfile(body);
      await refreshProfile();
      setMessage('Profile saved.');
      navigate('/coach');
    } catch (err) {
      setError(err.message + (fieldError(err, 'skill_rating') ? ` ${fieldError(err, 'skill_rating')}` : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>{creating ? 'Create coach profile' : 'Edit coach profile'}</h1>
      {readiness.coachUiPhase === 'hidden' ? <Alert tone="error">Coach access is not available on this account.</Alert> : null}
      <form className="card stack" onSubmit={onSubmit} style={{ maxWidth: 640 }}>
        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{message}</Alert>
        <FormField label="Headline" name="headline" value={form.headline} onChange={update} />
        <FormField label="Bio" name="bio">
          <textarea id="bio" name="bio" value={form.bio} onChange={update} />
        </FormField>
        <FormField label="Experience (years)" name="experience_years" type="number" value={form.experience_years} onChange={update} />
        <FormField label="Skill rating (2.0–6.0, half steps)" name="skill_rating" value={form.skill_rating} onChange={update} hint="e.g. 3.5" />
        <FormField label="Rating system" name="rating_system">
          <select id="rating_system" name="rating_system" value={form.rating_system} onChange={update}>
            <option value="self">Self-reported rating</option>
            <option value="DUPR">DUPR rating</option>
            <option value="UTR-P">UTR-P rating</option>
          </select>
        </FormField>
        <FormField label="Certifications" name="certifications" value={form.certifications} onChange={update} />
        <FormField label="Location" name="location" value={form.location} onChange={update} />
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </form>
    </div>
  );
}
