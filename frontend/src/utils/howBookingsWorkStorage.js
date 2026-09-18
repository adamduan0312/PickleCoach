/** Per-user, per-role dismiss state for the short how-bookings guide. */
const DISMISS_KEY = 'pc.howBookingsWork.dismissed';

function readMap() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

function storageKey(userId, role) {
  if (userId == null || !role) return null;
  return `${userId}:${role}`;
}

export function isHowBookingsWorkDismissed(userId, role) {
  const key = storageKey(userId, role);
  if (!key) return false;
  return Boolean(readMap()[key]);
}

export function dismissHowBookingsWork(userId, role) {
  const key = storageKey(userId, role);
  if (!key) return;
  const map = readMap();
  map[key] = true;
  writeMap(map);
}

/** Clear dismiss so the guide can show again (Settings / Help reopen). */
export function reopenHowBookingsWork(userId, role) {
  const key = storageKey(userId, role);
  if (!key) return;
  const map = readMap();
  delete map[key];
  writeMap(map);
}
