/**
 * Time zone options for Account Settings.
 * Values are IANA identifiers (stored); labels are user-facing only.
 * Friendly regional names are used instead of ambiguous abbreviations (EST, CST…).
 */

export const COMMON_GROUP = 'Common';

const GROUP_ORDER = [
  COMMON_GROUP,
  'United States & Canada',
  'Mexico & Central America',
  'Caribbean',
  'South America',
  'Other Americas',
  'Europe',
  'Africa',
  'Middle East',
  'Asia',
  'Australia & New Zealand',
  'Pacific',
  'Atlantic',
  'Indian Ocean',
  'Antarctica',
  'Other',
];

/** Curated zones with friendly labels, in display order within each group. */
const CURATED = [
  [COMMON_GROUP, 'America/New_York', 'Eastern Time (US & Canada)'],
  [COMMON_GROUP, 'America/Chicago', 'Central Time (US & Canada)'],
  [COMMON_GROUP, 'America/Denver', 'Mountain Time (US & Canada)'],
  [COMMON_GROUP, 'America/Los_Angeles', 'Pacific Time (US & Canada)'],
  [COMMON_GROUP, 'America/Anchorage', 'Alaska Time'],
  [COMMON_GROUP, 'Pacific/Honolulu', 'Hawaii Time'],
  [COMMON_GROUP, 'America/Phoenix', 'Arizona'],

  ['United States & Canada', 'America/Halifax', 'Atlantic Time (Canada)'],
  ['United States & Canada', 'America/St_Johns', 'Newfoundland Time'],
  ['United States & Canada', 'America/Regina', 'Saskatchewan'],
  ['United States & Canada', 'America/Indiana/Indianapolis', 'Indiana (East)'],
  ['United States & Canada', 'America/Detroit', 'Detroit'],
  ['United States & Canada', 'America/Toronto', 'Toronto'],
  ['United States & Canada', 'America/Vancouver', 'Vancouver'],
  ['United States & Canada', 'America/Edmonton', 'Edmonton'],
  ['United States & Canada', 'America/Winnipeg', 'Winnipeg'],
  ['United States & Canada', 'America/Boise', 'Boise'],
  ['United States & Canada', 'America/Juneau', 'Juneau'],

  ['Mexico & Central America', 'America/Mexico_City', 'Mexico City'],
  ['Mexico & Central America', 'America/Cancun', 'Cancún'],
  ['Mexico & Central America', 'America/Tijuana', 'Tijuana'],
  ['Mexico & Central America', 'America/Monterrey', 'Monterrey'],
  ['Mexico & Central America', 'America/Guatemala', 'Central America'],
  ['Mexico & Central America', 'America/Costa_Rica', 'Costa Rica'],
  ['Mexico & Central America', 'America/El_Salvador', 'El Salvador'],
  ['Mexico & Central America', 'America/Tegucigalpa', 'Honduras'],
  ['Mexico & Central America', 'America/Managua', 'Nicaragua'],
  ['Mexico & Central America', 'America/Panama', 'Panama'],

  ['Caribbean', 'America/Puerto_Rico', 'Puerto Rico'],
  ['Caribbean', 'America/Santo_Domingo', 'Dominican Republic'],
  ['Caribbean', 'America/Havana', 'Cuba'],
  ['Caribbean', 'America/Jamaica', 'Jamaica'],
  ['Caribbean', 'America/Nassau', 'Bahamas'],

  ['South America', 'America/Argentina/Buenos_Aires', 'Argentina'],
  ['South America', 'America/Sao_Paulo', 'Brazil (São Paulo)'],
  ['South America', 'America/Manaus', 'Brazil (Manaus)'],
  ['South America', 'America/Fortaleza', 'Brazil (Fortaleza)'],
  ['South America', 'America/Santiago', 'Chile'],
  ['South America', 'America/Bogota', 'Colombia'],
  ['South America', 'America/Lima', 'Peru'],
  ['South America', 'America/Caracas', 'Venezuela'],
  ['South America', 'America/Guayaquil', 'Ecuador'],
  ['South America', 'America/La_Paz', 'Bolivia'],
  ['South America', 'America/Montevideo', 'Uruguay'],
  ['South America', 'America/Asuncion', 'Paraguay'],

  ['Europe', 'Europe/London', 'London'],
  ['Europe', 'Europe/Dublin', 'Dublin'],
  ['Europe', 'Europe/Lisbon', 'Lisbon'],
  ['Europe', 'Europe/Paris', 'Central European Time (Paris)'],
  ['Europe', 'Europe/Berlin', 'Berlin'],
  ['Europe', 'Europe/Madrid', 'Madrid'],
  ['Europe', 'Europe/Rome', 'Rome'],
  ['Europe', 'Europe/Amsterdam', 'Amsterdam'],
  ['Europe', 'Europe/Brussels', 'Brussels'],
  ['Europe', 'Europe/Zurich', 'Zurich'],
  ['Europe', 'Europe/Vienna', 'Vienna'],
  ['Europe', 'Europe/Stockholm', 'Stockholm'],
  ['Europe', 'Europe/Oslo', 'Oslo'],
  ['Europe', 'Europe/Copenhagen', 'Copenhagen'],
  ['Europe', 'Europe/Warsaw', 'Warsaw'],
  ['Europe', 'Europe/Prague', 'Prague'],
  ['Europe', 'Europe/Budapest', 'Budapest'],
  ['Europe', 'Europe/Helsinki', 'Eastern European Time (Helsinki)'],
  ['Europe', 'Europe/Athens', 'Athens'],
  ['Europe', 'Europe/Bucharest', 'Bucharest'],
  ['Europe', 'Europe/Kyiv', 'Kyiv'],
  ['Europe', 'Europe/Istanbul', 'Istanbul'],
  ['Europe', 'Europe/Moscow', 'Moscow'],

  ['Africa', 'Africa/Cairo', 'Cairo'],
  ['Africa', 'Africa/Johannesburg', 'Johannesburg'],
  ['Africa', 'Africa/Lagos', 'Lagos'],
  ['Africa', 'Africa/Nairobi', 'Nairobi'],
  ['Africa', 'Africa/Casablanca', 'Casablanca'],
  ['Africa', 'Africa/Accra', 'Accra'],

  ['Middle East', 'Asia/Dubai', 'Dubai'],
  ['Middle East', 'Asia/Riyadh', 'Riyadh'],
  ['Middle East', 'Asia/Qatar', 'Qatar'],
  ['Middle East', 'Asia/Jerusalem', 'Jerusalem'],
  ['Middle East', 'Asia/Tehran', 'Tehran'],

  ['Asia', 'Asia/Karachi', 'Pakistan'],
  ['Asia', 'Asia/Kolkata', 'India'],
  ['Asia', 'Asia/Kathmandu', 'Nepal'],
  ['Asia', 'Asia/Dhaka', 'Bangladesh'],
  ['Asia', 'Asia/Bangkok', 'Bangkok'],
  ['Asia', 'Asia/Ho_Chi_Minh', 'Vietnam'],
  ['Asia', 'Asia/Jakarta', 'Jakarta'],
  ['Asia', 'Asia/Singapore', 'Singapore'],
  ['Asia', 'Asia/Kuala_Lumpur', 'Kuala Lumpur'],
  ['Asia', 'Asia/Manila', 'Philippines'],
  ['Asia', 'Asia/Hong_Kong', 'Hong Kong'],
  ['Asia', 'Asia/Shanghai', 'China'],
  ['Asia', 'Asia/Taipei', 'Taiwan'],
  ['Asia', 'Asia/Seoul', 'Korea'],
  ['Asia', 'Asia/Tokyo', 'Japan'],

  ['Australia & New Zealand', 'Australia/Sydney', 'Sydney'],
  ['Australia & New Zealand', 'Australia/Melbourne', 'Melbourne'],
  ['Australia & New Zealand', 'Australia/Brisbane', 'Brisbane'],
  ['Australia & New Zealand', 'Australia/Adelaide', 'Adelaide'],
  ['Australia & New Zealand', 'Australia/Darwin', 'Darwin'],
  ['Australia & New Zealand', 'Australia/Perth', 'Perth'],
  ['Australia & New Zealand', 'Australia/Hobart', 'Hobart'],
  ['Australia & New Zealand', 'Pacific/Auckland', 'Auckland'],

  ['Pacific', 'Pacific/Fiji', 'Fiji'],
  ['Pacific', 'Pacific/Guam', 'Guam'],
  ['Pacific', 'Pacific/Tongatapu', 'Tonga'],
  ['Pacific', 'Pacific/Pago_Pago', 'American Samoa'],
  ['Pacific', 'Pacific/Tahiti', 'Tahiti'],

  ['Other', 'UTC', 'Coordinated Universal Time (UTC)'],
];

/** Legacy names some engines still report → canonical id used above. */
const ALIASES = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Godthab': 'America/Nuuk',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Etc/UTC': 'UTC',
  'Etc/GMT': 'UTC',
};

const CURATED_BY_VALUE = new Map(CURATED.map(([group, value, label]) => [value, { group, value, label }]));

const PREFIX_GROUP = {
  America: 'Other Americas',
  Europe: 'Europe',
  Africa: 'Africa',
  Asia: 'Asia',
  Australia: 'Australia & New Zealand',
  Pacific: 'Pacific',
  Atlantic: 'Atlantic',
  Indian: 'Indian Ocean',
  Antarctica: 'Antarctica',
  Arctic: 'Other',
};

function canonical(value) {
  return ALIASES[value] || value;
}

function humanize(segment) {
  return segment.replace(/_/g, ' ');
}

/**
 * Friendly label for any IANA id (curated name when available, else "City" or "City, Region").
 * @param {string|null|undefined} value
 */
export function timezoneLabel(value) {
  if (!value) return '';
  const id = canonical(value);
  const curated = CURATED_BY_VALUE.get(id);
  if (curated) return curated.label;
  const parts = id.split('/');
  if (parts.length === 1) return humanize(parts[0]);
  const city = humanize(parts[parts.length - 1]);
  if (parts.length >= 3) return `${city}, ${humanize(parts[parts.length - 2])}`;
  return city;
}

/** Where Intl's generic name disagrees with the Settings labels (kept in sync with backend emails). */
const SHORT_NAME_OVERRIDES = {
  UTC: 'UTC',
  'America/Phoenix': 'Arizona Time',
  'Pacific/Honolulu': 'Hawaii Time',
};

/**
 * Compact zone name shown next to booking times, e.g. "Pacific Time", "Central European Time".
 */
export function timezoneShortLabel(value) {
  if (!value) return '';
  const id = canonical(value);
  if (SHORT_NAME_OVERRIDES[id]) return SHORT_NAME_OVERRIDES[id];
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'longGeneric' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName');
    if (part?.value && !/^GMT[+-]/.test(part.value)) return part.value;
  } catch {
    /* fall through */
  }
  return timezoneLabel(id);
}

function groupFor(value) {
  const curated = CURATED_BY_VALUE.get(value);
  if (curated) return curated.group;
  return PREFIX_GROUP[value.split('/')[0]] || 'Other';
}

/** Engine-supported IANA ids, falling back to the curated list. */
export function supportedTimezoneIds() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch {
    /* fall through */
  }
  return CURATED.map(([, value]) => value);
}

/**
 * Flat option list: Common first, then worldwide zones grouped by region.
 * Always includes every curated zone and the user's saved value.
 *
 * @param {{ ids?: string[], currentValue?: string|null }} [opts]
 * @returns {{ value: string, label: string, group: string }[]}
 */
export function buildTimezoneOptions({ ids = supportedTimezoneIds(), currentValue = null } = {}) {
  const seen = new Set();
  const options = [];

  const add = (raw) => {
    if (!raw) return;
    const value = canonical(raw);
    if (seen.has(value)) return;
    if (value.startsWith('Etc/') || value === 'Factory') return;
    seen.add(value);
    options.push({ value, label: timezoneLabel(value), group: groupFor(value) });
  };

  CURATED.forEach(([, value]) => add(value));
  ids.forEach(add);
  if (currentValue) add(currentValue);

  const curatedRank = new Map(CURATED.map(([, value], i) => [value, i]));
  const groupRank = (g) => {
    const i = GROUP_ORDER.indexOf(g);
    return i === -1 ? GROUP_ORDER.length : i;
  };

  return options.sort((a, b) => {
    const byGroup = groupRank(a.group) - groupRank(b.group);
    if (byGroup !== 0) return byGroup;
    const ra = curatedRank.has(a.value) ? curatedRank.get(a.value) : Infinity;
    const rb = curatedRank.has(b.value) ? curatedRank.get(b.value) : Infinity;
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label);
  });
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_/]/g, ' ');
}

/**
 * Filter options by a search query (matches label, region, and city names in the id).
 * @param {{ value: string, label: string, group: string }[]} options
 * @param {string} query
 */
export function filterTimezoneOptions(options, query) {
  const q = normalize(query).trim();
  if (!q) return options;
  const terms = q.split(/\s+/);
  return options.filter((o) => {
    const haystack = `${normalize(o.label)} ${normalize(o.group)} ${normalize(o.value)}`;
    return terms.every((t) => haystack.includes(t));
  });
}
