/**
 * Court duplicate detection helpers for coach create flow.
 * Pure / DB-light utilities — used before inserting a new court_locations row.
 */

/** Normalize for fuzzy compare: lowercase, strip punctuation, collapse whitespace, expand common abbrevs. */
export function normalizeCourtText(value) {
  if (value == null) return '';
  let s = String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\broad\b/g, 'rd')
    .replace(/\blane\b/g, 'ln')
    .replace(/\bcourt\b/g, 'ct')
    .replace(/\bparkway\b/g, 'pkwy')
    .replace(/\bcircle\b/g, 'cir')
    .replace(/\bpickleball\b/g, '')
    .replace(/\bcourts?\b/g, '');
  s = s.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

/** Dice coefficient on character bigrams (0–1). */
export function stringSimilarity(a, b) {
  const s1 = normalizeCourtText(a);
  const s2 = normalizeCourtText(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return s1 === s2 ? 1 : 0;

  const bigrams = (s) => {
    const map = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  };
  const b1 = bigrams(s1);
  const b2 = bigrams(s2);
  let overlap = 0;
  for (const [bg, c1] of b1) {
    const c2 = b2.get(bg) || 0;
    overlap += Math.min(c1, c2);
  }
  return (2 * overlap) / (s1.length - 1 + (s2.length - 1));
}

export function distanceMiles(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Classify a candidate relative to a proposed court.
 * @returns {'high' | 'possible' | null}
 */
export function classifyCourtDuplicate(proposed, existing) {
  const miles = distanceMiles(
    proposed.latitude,
    proposed.longitude,
    existing.latitude,
    existing.longitude,
  );
  const nameSim = stringSimilarity(proposed.name, existing.name);
  const addrSim = stringSimilarity(
    [proposed.address_line1, proposed.city, proposed.state, proposed.postal_code].filter(Boolean).join(' '),
    [existing.address_line1, existing.city, existing.state, existing.postal_code].filter(Boolean).join(' '),
  );

  // High confidence: very close + similar name, or near-identical address nearby
  if (miles != null && miles <= 0.07 && nameSim >= 0.72) return 'high';
  if (miles != null && miles <= 0.12 && nameSim >= 0.85) return 'high';
  if (miles != null && miles <= 0.15 && addrSim >= 0.88) return 'high';
  if (nameSim >= 0.92 && addrSim >= 0.85) return 'high';

  // Possible: close with weaker name match, or strong address match nearby
  if (miles != null && miles <= 0.05 && nameSim < 0.72) return 'possible'; // same pin, different name
  if (miles != null && miles <= 0.15 && (nameSim >= 0.55 || addrSim >= 0.7)) return 'possible';
  if (miles != null && miles <= 0.25 && nameSim >= 0.8) return 'possible';
  if (addrSim >= 0.9 && (miles == null || miles <= 0.5)) return 'possible';

  return null;
}

/**
 * Score candidates from a list of existing courts.
 * @returns {{ high_confidence: object[], possible: object[] }}
 */
export function rankCourtDuplicateCandidates(proposed, existingCourts, { limit = 5 } = {}) {
  const high = [];
  const possible = [];

  for (const court of existingCourts || []) {
    const level = classifyCourtDuplicate(proposed, court);
    if (!level) continue;
    const miles = distanceMiles(
      proposed.latitude,
      proposed.longitude,
      court.latitude,
      court.longitude,
    );
    const item = {
      id: court.id,
      name: court.name,
      address_line1: court.address_line1,
      city: court.city,
      state: court.state,
      postal_code: court.postal_code,
      country: court.country,
      latitude: court.latitude != null ? Number(court.latitude) : null,
      longitude: court.longitude != null ? Number(court.longitude) : null,
      is_private: Boolean(court.is_private),
      distance_miles: miles != null ? Math.round(miles * 100) / 100 : null,
      name_similarity: Math.round(stringSimilarity(proposed.name, court.name) * 100) / 100,
      confidence: level === 'high' ? 'high' : 'possible',
    };
    if (level === 'high') high.push(item);
    else possible.push(item);
  }

  const byDistance = (a, b) => (a.distance_miles ?? 999) - (b.distance_miles ?? 999);
  high.sort(byDistance);
  possible.sort(byDistance);

  // Avoid listing the same court in both buckets
  const highIds = new Set(high.map((c) => c.id));
  const possibleFiltered = possible.filter((c) => !highIds.has(c.id));

  return {
    high_confidence: high.slice(0, limit),
    possible: possibleFiltered.slice(0, limit),
  };
}
