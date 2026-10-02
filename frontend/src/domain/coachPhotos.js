/**
 * Coach "On the court" gallery — limits mirror backend/utils/coachPhotos.js.
 * The first photo is the cover. Photos are optional and never gate listing.
 */

export const COACH_PHOTO_MAX = 8;
export const COACH_PHOTO_TARGET = 5;
export const COACH_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const COACH_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
export const COACH_PHOTO_LIMITS_HINT = `JPG, PNG, or WebP · up to 5 MB each · up to ${COACH_PHOTO_MAX} photos`;

export const GALLERY_TITLE = 'On the court';

export function galleryIntro(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0];
  return first
    ? `See ${first} in action during lessons and on the court.`
    : 'See this coach in action during lessons and on the court.';
}

/** Desktop layout: big featured cover + up to two side tiles; the last tile shows "+N" for the rest. */
export function galleryLayout(photos) {
  const list = Array.isArray(photos) ? photos : [];
  return {
    featured: list[0] || null,
    side: list.slice(1, 3),
    moreCount: Math.max(0, list.length - 3),
  };
}

/** Lightbox index that wraps around both ends. */
export function wrapIndex(index, length) {
  if (!length) return 0;
  return ((index % length) + length) % length;
}

/** Copy of `list` with the item at `from` moved to `to`. */
export function moveItem(list, from, to) {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Client-side check before upload (the server re-validates).
 * @param {File[]} files
 * @param {number} currentCount
 * @returns {{ accepted: File[], problems: string[] }}
 */
export function planCoachPhotoUpload(files, currentCount) {
  const allowed = new Set(COACH_PHOTO_ACCEPT.split(','));
  const problems = [];
  const valid = [];
  for (const f of files || []) {
    if (!allowed.has(f.type)) problems.push(`${f.name} isn't a JPG, PNG, or WebP image.`);
    else if (f.size > COACH_PHOTO_MAX_BYTES) problems.push(`${f.name} is larger than 5 MB.`);
    else valid.push(f);
  }
  const remaining = Math.max(0, COACH_PHOTO_MAX - currentCount);
  if (valid.length > remaining) {
    problems.push(remaining
      ? `You can add ${remaining} more photo${remaining === 1 ? '' : 's'} (up to ${COACH_PHOTO_MAX} in total). Only the first ${remaining} ${remaining === 1 ? 'was' : 'were'} added.`
      : `You already have ${COACH_PHOTO_MAX} photos. Delete one to add another.`);
  }
  return { accepted: valid.slice(0, remaining), problems };
}
