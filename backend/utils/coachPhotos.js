/**
 * Coach "On the court" gallery rules (shared by controller + DTOs).
 * The first photo in order is the cover. Photos are optional: they never count toward
 * profile completeness or marketplace listing.
 */

export const MAX_COACH_PHOTOS = 8;
export const MAX_COACH_PHOTO_BYTES = 5 * 1024 * 1024;

const plain = (row) => (row?.toJSON ? row.toJSON() : row);

/** Gallery order by position (id breaks ties). */
export function orderCoachPhotos(rows) {
  return (rows || []).map(plain).sort((a, b) => (a.position - b.position) || (a.id - b.id));
}

/** Ordered public photo cards; `is_cover` marks the first. */
export function serializeCoachPhotoList(rows) {
  return orderCoachPhotos(rows).map((p, i) => ({ id: p.id, url: p.url, is_cover: i === 0 }));
}

/**
 * A reorder request must list every one of the coach's photos exactly once.
 * @param {number[]} existingIds
 * @param {unknown} requestedIds
 * @returns {{ ok: true, ids: number[] } | { ok: false, message: string }}
 */
export function validateCoachPhotoOrder(existingIds, requestedIds) {
  if (!Array.isArray(requestedIds)) return { ok: false, message: 'photo_ids must be an array.' };
  const ids = requestedIds.map(Number);
  const existing = new Set(existingIds.map(Number));
  if (
    ids.length !== existing.size
    || new Set(ids).size !== ids.length
    || ids.some((id) => !existing.has(id))
  ) {
    return { ok: false, message: 'photo_ids must list each of your photos exactly once.' };
  }
  return { ok: true, ids };
}

/** New order with `photoId` moved to the front (cover); the rest keep their relative order. */
export function orderWithCover(orderedIds, photoId) {
  const id = Number(photoId);
  return [id, ...orderedIds.map(Number).filter((x) => x !== id)];
}
