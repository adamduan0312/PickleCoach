/**
 * Lesson offering (Private / Group) presentation and coach form rules.
 * Limits mirror backend/utils/lessonOffering.js + createLessonSchema.
 *
 * Group is informational: one student books and pays and may bring friends.
 * It never means multiple PickleCoach accounts on one booking.
 */
import { CHAR_LIMITS } from '../utils/charLimits.js';

export const GROUP_MAX_PLAYERS_MIN = 2;
export const GROUP_MAX_PLAYERS_MAX = 12;
export const LESSON_TITLE_MIN = 3;
export const LESSON_PRICE_MIN_USD = 0.5;
export const LESSON_PRICE_MAX_USD = 1000;
export const LESSON_DURATION_OPTIONS = [30, 45, 60, 90, 120];

export const GROUP_LESSON_NOTE = 'Group lessons: one student books and pays, and may bring additional players.';

export function isGroupLesson(lesson) {
  return lesson?.lesson_type === 'group';
}

/** "Private lesson" or "Group lesson · Up to 6 players". */
export function lessonTypeLabel(lesson) {
  if (!isGroupLesson(lesson)) return 'Private lesson';
  const n = Number(lesson.max_players);
  return Number.isFinite(n) && n > 0 ? `Group lesson · Up to ${n} players` : 'Group lesson';
}

/**
 * Offering as booked: the booking's snapshot when present, else the lesson's
 * current values (legacy bookings created before snapshots existed).
 */
export function bookingLessonOffering(booking) {
  if (booking?.lesson_type_at_booking) {
    return {
      lesson_type: booking.lesson_type_at_booking,
      max_players: booking.max_players_at_booking ?? null,
    };
  }
  return {
    lesson_type: booking?.lesson?.lesson_type ?? null,
    max_players: booking?.lesson?.max_players ?? null,
  };
}

export function bookingLessonTypeLabel(booking) {
  return lessonTypeLabel(bookingLessonOffering(booking));
}

/** Lesson title as booked (snapshot), else the lesson's current title. */
export function bookingLessonTitle(booking) {
  return booking?.lesson_title_at_booking || booking?.lesson?.title || 'Lesson';
}

/** Supported durations, keeping a lesson's existing non-standard value selectable. */
export function durationOptionsFor(current) {
  const n = Number(current);
  const options = [...LESSON_DURATION_OPTIONS];
  if (Number.isInteger(n) && n > 0 && !options.includes(n)) {
    options.push(n);
    options.sort((a, b) => a - b);
  }
  return options;
}

/** Keep digits and one decimal point, at most two decimal places. */
export function sanitizePriceInput(value) {
  const cleaned = String(value ?? '').replace(/[^\d.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  if (!rest.length) return whole;
  return `${whole}.${rest.join('').slice(0, 2)}`;
}

export function emptyLessonForm() {
  return {
    title: '',
    lesson_type: 'private',
    max_players: '',
    description: '',
    duration_minutes: '60',
    price: '50',
  };
}

export function lessonToForm(lesson) {
  return {
    title: lesson.title || '',
    lesson_type: isGroupLesson(lesson) ? 'group' : 'private',
    max_players: isGroupLesson(lesson) && lesson.max_players != null ? String(lesson.max_players) : '',
    description: lesson.description || '',
    duration_minutes: String(lesson.duration_minutes || 60),
    price: lesson.price != null ? String(Number(lesson.price)) : '',
    is_active: lesson.is_active !== false,
  };
}

/**
 * Client-side checks matching the API so obvious mistakes show before Save.
 * @returns {Record<string, string>} field → message (empty when valid)
 */
export function validateLessonForm(form) {
  const errors = {};
  const title = String(form.title || '').trim();
  if (!title) errors.title = 'Enter a lesson title.';
  else if (title.length < LESSON_TITLE_MIN) errors.title = `Title must be at least ${LESSON_TITLE_MIN} characters.`;
  else if (title.length > CHAR_LIMITS.lessonTitle) errors.title = `Title must be ${CHAR_LIMITS.lessonTitle} characters or fewer.`;

  if (String(form.description || '').trim().length > CHAR_LIMITS.lessonDescription) {
    errors.description = `Description must be ${CHAR_LIMITS.lessonDescription} characters or fewer.`;
  }

  if (form.lesson_type === 'group') {
    const raw = String(form.max_players ?? '').trim();
    const n = Number(raw);
    if (!raw) {
      errors.max_players = `Enter the maximum number of players (${GROUP_MAX_PLAYERS_MIN}–${GROUP_MAX_PLAYERS_MAX}).`;
    } else if (!Number.isInteger(n) || n < GROUP_MAX_PLAYERS_MIN || n > GROUP_MAX_PLAYERS_MAX) {
      errors.max_players = `Maximum players must be a whole number from ${GROUP_MAX_PLAYERS_MIN} to ${GROUP_MAX_PLAYERS_MAX}.`;
    }
  }

  const duration = Number(form.duration_minutes);
  if (!Number.isInteger(duration) || duration < 15 || duration > 480) {
    errors.duration_minutes = 'Choose a lesson duration.';
  }

  const priceRaw = String(form.price ?? '').trim();
  const price = Number(priceRaw);
  if (!priceRaw || !Number.isFinite(price)) {
    errors.price = 'Enter a price.';
  } else if (price < LESSON_PRICE_MIN_USD) {
    errors.price = `Price must be at least $${LESSON_PRICE_MIN_USD.toFixed(2)}.`;
  } else if (price > LESSON_PRICE_MAX_USD) {
    errors.price = `Price must be $${LESSON_PRICE_MAX_USD.toLocaleString('en-US')} or less.`;
  } else if (!/^\d+(\.\d{1,2})?$/.test(priceRaw)) {
    errors.price = 'Price can have at most two decimal places.';
  }
  return errors;
}

/** API body for POST/PUT /lessons. Private lessons always send max_players: null. */
export function lessonFormToPayload(form) {
  const isGroup = form.lesson_type === 'group';
  return {
    title: String(form.title || '').trim(),
    lesson_type: isGroup ? 'group' : 'private',
    max_players: isGroup ? Number(form.max_players) : null,
    description: String(form.description || '').trim(),
    duration_minutes: Number(form.duration_minutes),
    price: Number(form.price),
  };
}

const LESSON_FORM_FIELDS = new Set(['title', 'lesson_type', 'max_players', 'description', 'duration_minutes', 'price']);

/**
 * Map API validation details (`[{ field, message }]`) onto form fields.
 * Unknown fields stay in `general` so nothing is silently dropped.
 */
export function lessonApiFieldErrors(err) {
  const details = Array.isArray(err?.details) ? err.details : [];
  const fields = {};
  const general = [];
  for (const d of details) {
    const field = String(d?.field || '');
    const message = d?.message || 'Invalid value.';
    if (LESSON_FORM_FIELDS.has(field) && !fields[field]) fields[field] = message;
    else if (!LESSON_FORM_FIELDS.has(field)) general.push(message);
  }
  return { fields, general: general.length ? general.join(' ') : null };
}
