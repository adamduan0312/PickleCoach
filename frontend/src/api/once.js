/**
 * Dedupe one-time token API calls (React Strict Mode remounts effects in dev).
 * Successful promises stay cached for the page lifetime; failures are cleared so retry works.
 */
const inflight = new Map();

export function oncePerKey(key, run) {
  if (!inflight.has(key)) {
    const promise = Promise.resolve()
      .then(run)
      .catch((err) => {
        inflight.delete(key);
        throw err;
      });
    inflight.set(key, promise);
  }
  return inflight.get(key);
}
