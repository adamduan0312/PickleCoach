/**
 * Primary nav link model for AppShell (desktop + mobile drawer).
 * Bell is the sole entry to /notifications — do not include a Notifications text link.
 */

/**
 * @param {{ mode: string|null, student: boolean, coach: boolean, admin: boolean }} opts
 * @returns {{ to: string, label: string, attention?: 'messages' | 'bookings' }[]}
 */
export function buildPrimaryNavLinks({ mode, student, coach, admin }) {
  /** @type {{ to: string, label: string, attention?: 'messages' | 'bookings' }[]} */
  const links = [];

  if (mode === 'admin' && admin) {
    links.push({ to: '/admin', label: 'Dashboard' });
    links.push({ to: '/admin/users', label: 'Users' });
    links.push({ to: '/admin/bookings', label: 'Bookings' });
    links.push({ to: '/admin/disputes', label: 'Disputes' });
    links.push({ to: '/admin/payments', label: 'Payments' });
    links.push({ to: '/admin/lessons', label: 'Lessons' });
    links.push({ to: '/admin/reviews', label: 'Reviews' });
  } else if (mode === 'coach' && coach) {
    links.push({ to: '/coach', label: 'Dashboard' });
    links.push({ to: '/coach/bookings', label: 'Bookings', attention: 'bookings' });
    links.push({ to: '/coach/lessons', label: 'Lessons' });
    links.push({ to: '/coach/availability', label: 'Availability' });
    links.push({ to: '/coach/courts', label: 'Courts' });
    if (student) links.push({ to: '/discover', label: 'Find a coach' });
  } else {
    links.push({ to: '/dashboard', label: 'Dashboard' });
    links.push({ to: '/discover', label: 'Find a coach' });
    links.push({ to: '/bookings', label: 'My bookings', attention: 'bookings' });
  }

  links.push({ to: '/messages', label: 'Messages', attention: 'messages' });
  return links;
}

/**
 * Accessible name for a nav item that may show an attention dot.
 * @param {string} label
 * @param {'messages' | 'bookings' | undefined} attention
 * @param {{ messages?: boolean, bookings?: boolean }} flags
 */
export function navItemAriaLabel(label, attention, flags = {}) {
  if (attention === 'messages' && flags.messages) {
    return `${label} — unread messages`;
  }
  if (attention === 'bookings' && flags.bookings) {
    return `${label} — action required`;
  }
  return label;
}

/**
 * Whether this nav item should show the attention dot.
 * @param {'messages' | 'bookings' | undefined} attention
 * @param {{ messages?: boolean, bookings?: boolean }} flags
 */
export function navItemShowsAttentionDot(attention, flags = {}) {
  if (attention === 'messages') return Boolean(flags.messages);
  if (attention === 'bookings') return Boolean(flags.bookings);
  return false;
}
