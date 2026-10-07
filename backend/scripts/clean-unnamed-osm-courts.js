/**
 * Cleanup for courts imported before OSM naming rules existed: placeholder names like
 * "Pickleball Court (way/123)", operator names like "City of Miami", and several listings for
 * pitches inside one OSM facility.
 *
 * Applies the same rules as discovery (see courtImportService):
 * - A court with its own OSM name keeps it.
 * - Otherwise it is named after the named park/facility it sits inside, unless that OSM facility
 *   already has a listing (then it is grouped into it) or a court with that name is within 0.25 mi.
 * - Courts with no usable name, and grouped duplicates, are deleted — unless a coach teaches there
 *   or a booking references them; those are kept and listed so they can be fixed by hand.
 * Rows whose Overpass lookup failed are left untouched.
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
  enclosingFacilities,
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

const osmKeyOf = (c) => `${c.osm_type}/${c.osm_id}`;

/** @returns {Promise<Map<string, { tags: object, facilityAreas: object[] }>|null>} null when Overpass failed */
async function lookupFeatures(rows) {
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
  const live = await CourtLocation.findAll({ where: { deleted_at: null }, order: [['id', 'ASC']] });
  const osmRows = live.filter((c) => c.osm_type && c.osm_id != null);
  const legacyPlaceholders = live.filter((c) => !(c.osm_type && c.osm_id != null) && isPlaceholderOsmCourtName(c.name));

  const lookup = new Map();
  const failed = new Set();
  for (let i = 0; i < osmRows.length; i += CHUNK) {
    const chunk = osmRows.slice(i, i + CHUNK);
    const result = await lookupFeatures(chunk);
    if (!result) chunk.forEach((c) => failed.add(c.id));
    else for (const [k, v] of result) lookup.set(k, v);
  }

  const ids = live.map((c) => c.id);
  const linked = new Set((await CoachCourtLocation.findAll({ where: { court_id: ids }, attributes: ['court_id'] }))
    .map((r) => r.court_id));
  const booked = new Set((await Booking.findAll({ where: { court_location_id: { [Op.in]: ids } }, attributes: ['court_location_id'] }))
    .map((r) => r.court_location_id));
  const inUse = (c) => linked.has(c.id) || booked.has(c.id);

  const plan = { rename: [], remove: [], keep: [], skipped: [] };
  const listedFacilities = new Set();
  const settled = [];
  const fallback = [];

  for (const court of osmRows) {
    const osm = lookup.get(osmKeyOf(court));
    if (failed.has(court.id)) {
      if (isPlaceholderOsmCourtName(court.name)) plan.skipped.push(court);
      continue;
    }
    if (!osm) {
      // Feature no longer in OSM: only placeholder rows are in scope.
      if (isPlaceholderOsmCourtName(court.name)) fallback.push({ court, named: null, facilities: [] });
      continue;
    }
    const named = osmCourtName(osm.tags, osm.facilityAreas);
    const facilities = enclosingFacilities(osm.facilityAreas);
    if (named?.source === 'osm') {
      settled.push(court);
      facilities.forEach((f) => listedFacilities.add(f.key));
    } else {
      fallback.push({ court, named, facilities });
    }
  }
  settled.push(...live.filter((c) => !(c.osm_type && c.osm_id != null) && !isPlaceholderOsmCourtName(c.name)));

  // Courts in use get first claim on a facility.
  fallback.sort((a, b) => Number(inUse(b.court)) - Number(inUse(a.court)) || a.court.id - b.court.id);
  const drop = (court, reason) => (inUse(court) ? plan.keep : plan.remove).push({ court, reason });

  for (const { court, named, facilities } of fallback) {
    if (!named) {
      drop(court, 'no court or facility name');
      continue;
    }
    if (listedFacilities.has(named.facilityKey)) {
      drop(court, `another listing already covers ${named.name} (${named.facilityKey})`);
      continue;
    }
    const sameNameNearby = settled.some((c) => c.name === named.name
      && court.latitude != null && c.latitude != null
      && calculateDistance(court.latitude, court.longitude, c.latitude, c.longitude) < SAME_NAME_MILES);
    if (sameNameNearby) {
      drop(court, `"${named.name}" is already listed nearby`);
      continue;
    }
    if (court.name !== named.name) plan.rename.push({ court, name: named.name });
    settled.push({ name: named.name, latitude: court.latitude, longitude: court.longitude });
    facilities.forEach((f) => listedFacilities.add(f.key));
  }
  for (const court of legacyPlaceholders) drop(court, 'legacy placeholder without an OSM id');

  console.log(`${live.length} live courts checked (${apply ? 'APPLY' : 'dry run'})`);
  for (const { court, name } of plan.rename) console.log(`  rename #${court.id} ${court.name} → ${name}`);
  for (const { court, reason } of plan.remove) console.log(`  delete #${court.id} ${court.name} (${reason})`);
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
