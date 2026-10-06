/**
 * One-time cleanup for courts imported before unnamed OSM features were withheld, i.e. rows
 * named like "Pickleball Court (way/123)".
 *
 * For each such row:
 * - If the OSM feature sits inside a named park/facility (same lookup discovery now uses) and no
 *   other court nearby already has that name, rename it (e.g. "Weston Regional Park").
 * - Otherwise delete it, unless a coach teaches there or a booking references it — those are kept
 *   and listed so they can be fixed by hand.
 * Rows whose Overpass lookup failed are left untouched. Discovery never recreates these names.
 *
 * Usage (from backend/):
 *   node scripts/clean-unnamed-osm-courts.js           # dry run: prints the plan
 *   node scripts/clean-unnamed-osm-courts.js --apply   # writes changes
 */
import dotenv from 'dotenv';
import { Op } from 'sequelize';
import { sequelize, CourtLocation, CoachCourtLocation, Booking } from '../models/index.js';
import {
  buildOsmFeaturesFacilityQuery,
  calculateDistance,
  fetchOverpass,
  groupCourtsWithFacilities,
  isPlaceholderOsmCourtName,
  osmCourtName,
} from '../services/courtImportService.js';

const env = process.env.NODE_ENV || 'development';
dotenv.config({ path: `.env.${env}` });

sequelize.options.logging = false;

const apply = process.argv.includes('--apply');
const CHUNK = 100;
const SAME_NAME_MILES = 0.25;
const NEARBY_MILES = 0.1;

/** @returns {Promise<Map<string, object[]>|null>} "way/123" → facility tags; null when Overpass failed */
async function facilityAreasFor(rows) {
  const idsByType = {};
  for (const r of rows) (idsByType[r.osm_type] ||= []).push(String(r.osm_id));
  try {
    const data = await fetchOverpass(buildOsmFeaturesFacilityQuery(idsByType));
    const byKey = new Map();
    for (const { element, facilityAreas } of groupCourtsWithFacilities(data?.elements || [])) {
      byKey.set(`${element.type}/${element.id}`, { tags: element.tags || {}, facilityAreas });
    }
    return byKey;
  } catch (err) {
    console.warn(`Overpass lookup failed for ${rows.length} rows: ${err.message}`);
    return null;
  }
}

async function main() {
  const candidates = (await CourtLocation.findAll({
    where: { deleted_at: null, name: { [Op.like]: 'Pickleball Court (%' } },
    order: [['id', 'ASC']],
  })).filter((c) => isPlaceholderOsmCourtName(c.name));

  const ids = candidates.map((c) => c.id);
  const linked = new Set((await CoachCourtLocation.findAll({ where: { court_id: ids }, attributes: ['court_id'] }))
    .map((r) => r.court_id));
  const booked = new Set((await Booking.findAll({ where: { court_location_id: ids }, attributes: ['court_location_id'] }))
    .map((r) => r.court_location_id));
  const inUse = (c) => linked.has(c.id) || booked.has(c.id);

  const osmRows = candidates.filter((c) => c.osm_type && c.osm_id != null);
  const lookup = new Map();
  const failed = new Set();
  for (let i = 0; i < osmRows.length; i += CHUNK) {
    const chunk = osmRows.slice(i, i + CHUNK);
    const result = await facilityAreasFor(chunk);
    if (!result) chunk.forEach((c) => failed.add(c.id));
    else for (const [k, v] of result) lookup.set(k, v);
  }

  // Courts in use get first claim on a facility name.
  const ordered = [...candidates].sort((a, b) => Number(inUse(b)) - Number(inUse(a)) || a.id - b.id);
  const claimed = [];
  const plan = { rename: [], remove: [], keep: [], skipped: [] };

  for (const court of ordered) {
    if (failed.has(court.id)) {
      plan.skipped.push(court);
      continue;
    }
    const osm = court.osm_type ? lookup.get(`${court.osm_type}/${court.osm_id}`) : null;
    const named = osm ? osmCourtName(osm.tags, osm.facilityAreas) : null;
    const name = named?.name ?? null;

    // Same rules as discovery: same name within 0.25 mi, or any listed court within 0.1 mi
    // when the name only comes from the enclosing facility.
    let duplicate = false;
    if (name && court.latitude != null && court.longitude != null) {
      const nearby = (await CourtLocation.findAll({
        where: {
          deleted_at: null,
          id: { [Op.ne]: court.id },
          latitude: { [Op.between]: [court.latitude - 0.005, court.latitude + 0.005] },
          longitude: { [Op.between]: [court.longitude - 0.005, court.longitude + 0.005] },
        },
      })).filter((c) => !isPlaceholderOsmCourtName(c.name));
      duplicate = [...nearby, ...claimed].some((c) => {
        const d = calculateDistance(court.latitude, court.longitude, c.latitude, c.longitude);
        return (c.name === name && d < SAME_NAME_MILES) || (named.source === 'facility' && d < NEARBY_MILES);
      });
    }

    if (name && !duplicate) {
      plan.rename.push({ court, name });
      claimed.push({ name, latitude: court.latitude, longitude: court.longitude });
    } else if (inUse(court)) {
      plan.keep.push({ court, reason: name ? `duplicate of nearby "${name}"` : 'no facility name' });
    } else {
      plan.remove.push({ court, reason: name ? `duplicate of nearby "${name}"` : 'no facility name' });
    }
  }

  console.log(`${candidates.length} placeholder-named courts (${apply ? 'APPLY' : 'dry run'})`);
  for (const { court, name } of plan.rename) console.log(`  rename #${court.id} ${court.name} → ${name}`);
  for (const { court, reason } of plan.keep) console.log(`  keep   #${court.id} ${court.name} (in use; ${reason})`);
  for (const court of plan.skipped) console.log(`  skip   #${court.id} ${court.name} (Overpass lookup failed)`);
  console.log(`rename ${plan.rename.length}, delete ${plan.remove.length}, keep ${plan.keep.length}, skipped ${plan.skipped.length}`);

  if (!apply) return;
  for (const { court, name } of plan.rename) {
    try {
      await court.update({ name });
    } catch (err) {
      console.warn(`  rename #${court.id} failed (${err.message}); leaving as is`);
    }
  }
  if (plan.remove.length) {
    await CourtLocation.destroy({ where: { id: plan.remove.map((r) => r.court.id) } });
  }
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
