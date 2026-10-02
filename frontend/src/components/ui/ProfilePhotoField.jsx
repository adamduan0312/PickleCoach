import { useRef, useState } from 'react';
import { authApi } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Avatar } from './Avatar.jsx';
import { Alert } from './States.jsx';

/** Mirrors backend/middleware/avatarUpload.js (MIME allow-list, MAX_AVATAR_BYTES). */
export const ACCEPTED_PHOTO_TYPES = 'image/jpeg,image/png,image/webp';
export const PHOTO_LIMITS_HINT = 'JPG, PNG, or WebP · up to 2 MB';

/**
 * Account-level profile photo (users.avatar_url) — one photo across nav, Discover, messages,
 * checkout, and the public coach profile. Uploads and removals save immediately, independent
 * of any surrounding form's Save button.
 */
export function ProfilePhotoField({ id = 'profile-photo', note, disabled = false, onBusyChange }) {
  const { user, refreshProfile } = useAuth();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const hasPhoto = Boolean(user?.avatar_url);
  const labelId = `${id}-label`;

  async function run(action, successMessage) {
    setBusy(true);
    onBusyChange?.(true);
    setMessage(null);
    setError(null);
    try {
      await action();
      await refreshProfile();
      setMessage(successMessage);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  function onFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    run(() => authApi.uploadAvatar(file), 'Profile photo updated.');
  }

  return (
    <div className="field settings-photo-field">
      <span className="settings-photo-label" id={labelId}>Profile photo</span>
      <div className="row settings-photo-row" aria-labelledby={labelId}>
        <Avatar name={user?.full_name} src={user?.avatar_url} size="lg" />
        <div className="stack settings-photo-actions">
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept={ACCEPTED_PHOTO_TYPES}
            hidden
            onChange={onFileSelected}
          />
          <button
            className="btn secondary"
            type="button"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Saving…' : hasPhoto ? 'Change photo' : 'Upload photo'}
          </button>
          {hasPhoto ? (
            <button
              className="btn ghost"
              type="button"
              disabled={disabled || busy}
              onClick={() => run(() => authApi.removeAvatar(), 'Profile photo removed.')}
            >
              Remove photo
            </button>
          ) : null}
          <span className="muted small">{PHOTO_LIMITS_HINT}</span>
        </div>
      </div>
      {note ? <span className="muted small">{note}</span> : null}
      <div aria-live="polite">
        <Alert tone="error">{error}</Alert>
        <Alert tone="success">{message}</Alert>
      </div>
    </div>
  );
}
