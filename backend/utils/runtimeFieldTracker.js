/**
 * Optional Sequelize instance field-access counter (development / diagnostics only).
 *
 * Enable with: `TRACK_MODEL_FIELDS=true` (default: off).
 *
 * Does **not** auto-wrap models — call `wrapInstanceForFieldTracking` around a row
 * when debugging locally, or `wrapModel(Model, name)` to proxy static calls and wrap
 * returned instances (optional dev-only). Aggregates are printed on `beforeExit`.
 */

const counts = new Map();
let enabled = process.env.TRACK_MODEL_FIELDS === 'true';

/** @param {string} entityName e.g. "Booking" */
export function trackFieldAccess(entityName, fieldName) {
  if (!enabled) return;
  const key = `${entityName}.${fieldName}`;
  counts.set(key, (counts.get(key) || 0) + 1);
}

/**
 * Wrap a plain Sequelize instance for `get` traps (reads only).
 * @template T
 * @param {T} instance
 * @param {string} entityName
 * @returns {T}
 */
export function wrapInstanceForFieldTracking(instance, entityName) {
  if (!enabled || !instance || typeof instance !== 'object') {
    return instance;
  }
  return new Proxy(instance, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop !== 'then' && !prop.startsWith('_')) {
        trackFieldAccess(entityName, prop);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function looksLikeSequelizeInstance(obj) {
  return obj && typeof obj === 'object' && ('dataValues' in obj || 'isNewRecord' in obj);
}

function wrapQueryResult(result, entityName) {
  if (result == null) return result;
  if (Array.isArray(result)) {
    return result.map((row) =>
      looksLikeSequelizeInstance(row) ? wrapInstanceForFieldTracking(row, entityName) : row,
    );
  }
  if (looksLikeSequelizeInstance(result)) {
    return wrapInstanceForFieldTracking(result, entityName);
  }
  return result;
}

/**
 * Dev-only proxy around a Sequelize Model class: wraps return values from static
 * methods when they look like instance(s). Does not replace imports site-wide.
 * @template T
 * @param {T} Model
 * @param {string} entityName
 * @returns {T}
 */
export function wrapModel(Model, entityName) {
  if (!enabled || !Model || typeof Model !== 'function') {
    return Model;
  }
  return new Proxy(Model, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== 'function' || prop === 'constructor') {
        return orig;
      }
      return function (...args) {
        const out = orig.apply(target, args);
        if (out && typeof out.then === 'function') {
          return out.then((r) => wrapQueryResult(r, entityName));
        }
        return wrapQueryResult(out, entityName);
      };
    },
  });
}

export function isModelFieldTrackingEnabled() {
  return enabled;
}

export function setModelFieldTrackingEnabled(v) {
  enabled = Boolean(v);
}

export function resetFieldAccessCounts() {
  counts.clear();
}

export function getFieldAccessSnapshot() {
  return new Map(counts);
}

function dump() {
  if (!enabled || counts.size === 0) return;
  const byEntity = new Map();
  for (const [k, n] of counts) {
    const [ent] = k.split('.');
    if (!byEntity.has(ent)) byEntity.set(ent, []);
    byEntity.get(ent).push([k, n]);
  }
  console.log('[runtimeFieldTracker] aggregate field reads (TRACK_MODEL_FIELDS=true)');
  for (const [ent, rows] of [...byEntity.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${ent}: ${rows.length} distinct keys, total reads ${rows.reduce((s, [, c]) => s + c, 0)}`);
    for (const [key, c] of rows.sort((a, b) => b[1] - a[1]).slice(0, 30)) {
      console.log(`    ${key}: ${c}`);
    }
  }
}

if (typeof process !== 'undefined' && process.env?.TRACK_MODEL_FIELDS === 'true') {
  process.once('beforeExit', () => dump());
}
