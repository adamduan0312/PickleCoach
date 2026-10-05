import { useEffect, useState } from 'react';

/** `keepData`: leave the previous result on screen while a dependency change reloads it. */
export function useAsync(loader, deps = [], { keepData = false } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (!keepData) setData(null);
    Promise.resolve()
      .then(loader)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, setData, reloadKey: deps };
}
