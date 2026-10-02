import { COACH_PROFILE_REQUIRED_FIELDS, incompleteProfileMessage } from './coachProfileCompleteness.js';

/** Marketplace setup steps a coach must finish before students can see their lessons. */
export const COACH_SETUP_STEPS = {
  profile: { label: 'Coach profile', to: '/coach/profile' },
  stripe: { label: 'Payouts', to: '/coach/stripe' },
  lesson: { label: 'Lessons', to: '/coach/lessons' },
  court: { label: 'Courts', to: '/coach/courts' },
  availability: { label: 'Availability', to: '/coach/availability' },
};

/** Dashboard order: payouts last, since it needs a profile and is the most involved step. */
export const COACH_SETUP_ORDER = ['profile', 'lesson', 'court', 'availability', 'stripe'];

const CHECKLIST_LABELS = {
  profile: 'Coach profile',
  lesson: 'First lesson',
  court: 'Teaching court',
  availability: 'Availability',
  stripe: 'Payouts',
};

export const PAYOUTS_NEED_PROFILE = 'Create your profile first';

/** `missing` keys from GET /coaches/me/marketplace-status → [{ key, label, to }] in COACH_SETUP_ORDER. */
export function missingSetupSteps(missing) {
  const set = new Set(Array.isArray(missing) ? missing : []);
  return COACH_SETUP_ORDER
    .filter((key) => set.has(key))
    .map((key) => ({ key, ...COACH_SETUP_STEPS[key] }));
}

function nextStepCopy(key, { coachUiPhase, profileExists, profileMissingFields }) {
  switch (key) {
    case 'profile':
      return profileExists
        ? {
          title: 'Complete your coach profile',
          detail: incompleteProfileMessage(profileMissingFields?.length ? profileMissingFields : COACH_PROFILE_REQUIRED_FIELDS),
          cta: 'Complete profile',
        }
        : { title: 'Create your coach profile', detail: 'Build the basic profile students see before booking.', cta: 'Start setup' };
    case 'lesson':
      return { title: 'Add your first lesson', detail: 'Lessons are what students book with you.', cta: 'Go to Lessons' };
    case 'court':
      return { title: 'Add a teaching court', detail: 'Tell students where your lessons take place.', cta: 'Go to Courts' };
    case 'availability':
      return { title: 'Set your availability', detail: 'Add weekly windows so students can pick a time.', cta: 'Go to Availability' };
    case 'stripe':
      return coachUiPhase === 'complete_stripe'
        ? { title: 'Finish payout setup', detail: 'Your Stripe account is linked but onboarding isn’t complete.', cta: 'Continue payout setup' }
        : { title: 'Set up payouts', detail: 'Connect Stripe so you can get paid for lessons.', cta: 'Connect payouts' };
    default:
      return null;
  }
}

/**
 * Dashboard setup view from marketplace-status `steps` ({ profile: bool, ... }).
 * `steps.profile` means the profile is complete; `profileExists` (a saved draft is enough)
 * is what unlocks payouts. `next` is the first incomplete step in COACH_SETUP_ORDER
 * (null once everything is done).
 */
export function coachSetupView(steps, { coachUiPhase, profileExists, profileMissingFields } = {}) {
  const s = steps || {};
  const exists = Boolean(profileExists ?? s.profile);
  const checklist = COACH_SETUP_ORDER.map((key) => {
    const disabled = key === 'stripe' && !exists && !s.stripe;
    return {
      key,
      label: CHECKLIST_LABELS[key],
      to: COACH_SETUP_STEPS[key].to,
      done: Boolean(s[key]),
      disabled,
      hint: disabled ? PAYOUTS_NEED_PROFILE : null,
    };
  });
  const first = checklist.find((item) => !item.done);
  const next = first
    ? { key: first.key, to: first.to, ...nextStepCopy(first.key, { coachUiPhase, profileExists: exists, profileMissingFields }) }
    : null;
  return { checklist, next };
}

/**
 * Lessons a coach sees on their own public profile: the marketplace list when listed,
 * otherwise their own active lessons as a preview (students still see none).
 */
export function ownProfileLessonPreview({ marketplaceLessons, ownLessons, status }) {
  if (!status || status.listed) return { preview: false, lessons: marketplaceLessons || [] };
  const active = (ownLessons || []).filter((l) => l && l.is_active !== false && !l.deleted_at);
  return { preview: true, lessons: active, missing: missingSetupSteps(status.missing) };
}
