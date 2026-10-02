import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { coachesApi } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard.js';
import { FormField } from '../../components/ui/FormField.jsx';
import { PlaceAutocomplete } from '../../components/ui/PlaceAutocomplete.jsx';
import { CertificationsInput } from '../../components/ui/CertificationsInput.jsx';
import { ProfilePhotoField } from '../../components/ui/ProfilePhotoField.jsx';
import { CharacterCounter } from '../../components/ui/CharacterLimit.jsx';
import { CHAR_LIMITS } from '../../utils/charLimits.js';
import { Alert } from '../../components/ui/States.jsx';
import {
  COACH_PROFILE_LIMITS,
  COACH_RATING_SYSTEMS,
  certificationList,
  coachProfileApiFieldErrors,
  coachProfileFormToPayload,
  coachProfileToForm,
  ratingFieldCopy,
  ratingSwitchMessage,
  sanitizeRatingInput,
  sanitizeWholeNumberInput,
  validateCoachProfileForm,
  validateSkillRatingForSystem,
} from '../../domain/coachRating.js';
import {
  COACH_PROFILE_REQUIREMENT_HINTS,
  coachProfileMissingFields,
  incompleteProfileMessage,
} from '../../domain/coachProfileCompleteness.js';

/** Blank or duplicate certification rows alone don't count as unsaved changes. */
function comparableForm(form) {
  return { ...form, certifications: certificationList(form.certifications) };
}

export function CoachProfileEditPage() {
  const { user, refreshProfile, readiness } = useAuth();
  const existing = user?.coachProfile;
  const creating = !existing;
  const navigate = useNavigate();
  const [initialForm, setInitialForm] = useState(() => coachProfileToForm(existing));
  const [form, setForm] = useState(initialForm);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [incompleteNotice, setIncompleteNotice] = useState(null);
  const statusRef = useRef(null);

  const isDirty = JSON.stringify(comparableForm(form)) !== JSON.stringify(comparableForm(initialForm));
  const { allowNavigation } = useUnsavedChangesGuard(isDirty);
  const ratingCopy = ratingFieldCopy(form.rating_system);

  useEffect(() => {
    if (isDirty) {
      setMessage(null);
      setIncompleteNotice(null);
    }
  }, [isDirty]);

  useEffect(() => {
    if (message || error) statusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [message, error]);

  function setField(name, value) {
    setForm((f) => ({ ...f, [name]: value }));
    setFieldErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
  }

  function setCertifications(rows) {
    setForm((f) => ({ ...f, certifications: rows }));
    setFieldErrors((e) => Object.fromEntries(
      Object.entries(e).filter(([k]) => k !== 'certifications' && !k.startsWith('certifications.')),
    ));
  }

  function update(e) {
    setField(e.target.name, e.target.value);
  }

  function ratingError(system, rating) {
    return rating.trim() === '' ? undefined : validateSkillRatingForSystem(system, rating) || undefined;
  }

  function onRatingSystemChange(e) {
    const system = e.target.value;
    setForm((f) => ({ ...f, rating_system: system }));
    const bad = ratingError(system, form.skill_rating);
    setFieldErrors((errs) => ({
      ...errs,
      rating_system: undefined,
      skill_rating: bad ? ratingSwitchMessage(form.skill_rating, system) : undefined,
    }));
  }

  function onRatingChange(e) {
    const value = sanitizeRatingInput(e.target.value);
    setForm((f) => ({ ...f, skill_rating: value }));
    if (fieldErrors.skill_rating) {
      setFieldErrors((errs) => ({ ...errs, skill_rating: ratingError(form.rating_system, value) }));
    }
  }

  function onRatingBlur() {
    setFieldErrors((errs) => ({ ...errs, skill_rating: ratingError(form.rating_system, form.skill_rating) }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setIncompleteNotice(null);
    const clientErrors = validateCoachProfileForm(form);
    if (Object.keys(clientErrors).length) {
      setFieldErrors(clientErrors);
      return;
    }
    setBusy(true);
    const body = coachProfileFormToPayload(form);
    try {
      if (creating) {
        await coachesApi.createProfile(body);
        await refreshProfile();
        allowNavigation();
        navigate('/coach', { state: { flash: 'Profile created.' } });
        return;
      }
      await coachesApi.updateMyProfile(body);
      const fresh = await refreshProfile();
      const saved = coachProfileToForm(fresh?.coachProfile);
      setForm(saved);
      setInitialForm(saved);
      setFieldErrors({});
      setMessage('Profile saved.');
      const stillMissing = coachProfileMissingFields(fresh?.coachProfile);
      setIncompleteNotice(stillMissing.length ? incompleteProfileMessage(stillMissing) : null);
    } catch (err) {
      const { fields, general } = coachProfileApiFieldErrors(err);
      setFieldErrors(fields);
      setError(general || (Object.keys(fields).length ? null : err.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>{creating ? 'Create coach profile' : 'Edit coach profile'}</h1>
      {readiness.coachUiPhase === 'hidden' ? <Alert tone="error">Coach access is not available on this account.</Alert> : null}
      <form className="card stack" onSubmit={onSubmit} noValidate style={{ maxWidth: 640 }}>
        <ProfilePhotoField
          id="coach-profile-photo"
          note="This photo is used across your account and saves as soon as you upload it."
          disabled={busy}
          onBusyChange={setPhotoBusy}
        />
        <p className="small muted profile-required-note">
          * Required before students can see your profile. You can save a draft and finish later.
        </p>
        <FormField
          label="Headline *"
          name="headline"
          value={form.headline}
          onChange={update}
          maxLength={CHAR_LIMITS.coachHeadline}
          hint={COACH_PROFILE_REQUIREMENT_HINTS.headline}
          error={fieldErrors.headline}
        />
        <CharacterCounter value={form.headline} max={CHAR_LIMITS.coachHeadline} className="tight-top" />
        <FormField label="Bio *" name="bio" hint={COACH_PROFILE_REQUIREMENT_HINTS.bio} error={fieldErrors.bio}>
          <textarea
            id="bio"
            name="bio"
            value={form.bio}
            onChange={update}
            maxLength={COACH_PROFILE_LIMITS.bio}
            placeholder="Tell students about your coaching experience, style, and what they can expect."
          />
        </FormField>
        <CharacterCounter value={form.bio} max={COACH_PROFILE_LIMITS.bio} className="tight-top" />
        <FormField
          label="Experience (years)"
          name="experience_years"
          inputMode="numeric"
          value={form.experience_years}
          onChange={(e) => setField('experience_years', sanitizeWholeNumberInput(e.target.value))}
          hint={`Whole number from 0 to ${COACH_PROFILE_LIMITS.experienceYearsMax}.`}
          error={fieldErrors.experience_years}
        />
        <FormField label="Rating system" name="rating_system" error={fieldErrors.rating_system}>
          <select id="rating_system" name="rating_system" value={form.rating_system} onChange={onRatingSystemChange}>
            {Object.values(COACH_RATING_SYSTEMS).map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </FormField>
        <FormField
          label={ratingCopy.label}
          name="skill_rating"
          inputMode="decimal"
          autoComplete="off"
          value={form.skill_rating}
          onChange={onRatingChange}
          onBlur={onRatingBlur}
          placeholder={ratingCopy.placeholder}
          hint={ratingCopy.hint}
          error={fieldErrors.skill_rating}
        />
        <FormField
          label="Certifications"
          name="certifications"
          hint="List relevant coaching certifications or credentials."
          error={fieldErrors.certifications}
        >
          <CertificationsInput
            id="certifications"
            value={form.certifications}
            onChange={setCertifications}
            maxLength={COACH_PROFILE_LIMITS.certification}
            maxCount={COACH_PROFILE_LIMITS.certificationsMaxCount}
            errors={fieldErrors}
          />
        </FormField>
        <FormField
          label="Location (Based in) *"
          name="location"
          hint="Choose a city and state or ZIP code. This appears publicly as “Based in” and is separate from your teaching locations."
          error={fieldErrors.location}
        >
          <PlaceAutocomplete
            id="location"
            value={form.location}
            onChange={(v) => setField('location', v)}
            maxLength={COACH_PROFILE_LIMITS.location}
            placeholder="e.g. Davie, FL"
            invalid={Boolean(fieldErrors.location)}
          />
        </FormField>
        {error || message ? (
          <div ref={statusRef} className="stack" aria-live="polite">
            <Alert tone="error">{error}</Alert>
            <Alert tone="success">{message}</Alert>
            <Alert tone="warning">{incompleteNotice}</Alert>
          </div>
        ) : null}
        <div className="row">
          <button className="btn" type="submit" disabled={busy || photoBusy}>
            {busy ? 'Saving…' : creating ? 'Save profile' : 'Save changes'}
          </button>
          {!creating && user?.id ? (
            <Link className="btn secondary" to={`/coaches/${user.id}`}>View public profile</Link>
          ) : null}
        </div>
      </form>
    </div>
  );
}
