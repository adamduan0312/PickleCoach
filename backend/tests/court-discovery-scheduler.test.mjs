/**
 * Background OSM discovery scheduling for geographic GET /api/courts (no live network).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCourtDiscoveryScheduler } from '../services/courtDiscoveryScheduler.js';

const HOUR = 3600000;

function setup({ discoverFn } = {}) {
  let t = 1_000_000;
  const calls = [];
  const scheduler = createCourtDiscoveryScheduler({
    discoverFn: discoverFn || (async (...args) => { calls.push(args); }),
    now: () => t,
    cooldownMs: 6 * HOUR,
    failureCooldownMs: 10 * 60000,
  });
  return {
    scheduler,
    calls,
    advance(ms) { t += ms; },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createCourtDiscoveryScheduler', () => {
  it('starts discovery for a new area and returns before it finishes', async () => {
    const gate = deferred();
    let started = false;
    const { scheduler } = setup({
      discoverFn: async () => { started = true; await gate.promise; },
    });
    const r = scheduler.schedule(26.07, -80.25, 25);
    assert.equal(r.status, 'started');
    assert.ok(r.promise instanceof Promise);
    gate.resolve();
    await r.promise;
    assert.equal(started, true);
  });

  it('reports running for a covered area while discovery is in flight', async () => {
    const gate = deferred();
    let calls = 0;
    const { scheduler } = setup({ discoverFn: async () => { calls += 1; await gate.promise; } });
    const first = scheduler.schedule(26.07, -80.25, 25);
    assert.equal(scheduler.schedule(26.07, -80.25, 25).status, 'running');
    assert.equal(scheduler.schedule(26.1, -80.2, 10).status, 'running', 'smaller area inside running one');
    gate.resolve();
    await first.promise;
    assert.equal(calls, 1);
  });

  it('reports recent after success until the cooldown expires', async () => {
    const { scheduler, calls, advance } = setup();
    await scheduler.schedule(26.07, -80.25, 25).promise;
    assert.equal(scheduler.schedule(26.07, -80.25, 25).status, 'recent');
    assert.equal(scheduler.schedule(26.0701, -80.2501, 25).status, 'recent', 'GPS jitter is covered');
    assert.equal(scheduler.schedule(26.07, -80.25, 5).status, 'recent', 'smaller radius is covered');
    advance(6 * HOUR + 1);
    const again = scheduler.schedule(26.07, -80.25, 25);
    assert.equal(again.status, 'started');
    await again.promise;
    assert.equal(calls.length, 2);
  });

  it('starts a new discovery when the area is larger or elsewhere', async () => {
    const { scheduler, calls } = setup();
    await scheduler.schedule(26.07, -80.25, 10).promise;
    const bigger = scheduler.schedule(26.07, -80.25, 50);
    assert.equal(bigger.status, 'started');
    await bigger.promise;
    const elsewhere = scheduler.schedule(40.71, -74.0, 10);
    assert.equal(elsewhere.status, 'started');
    await elsewhere.promise;
    assert.deepEqual(calls, [[26.07, -80.25, 10], [26.07, -80.25, 50], [40.71, -74.0, 10]]);
  });

  it('uses the short failure cooldown and never rejects when discovery throws', async () => {
    let calls = 0;
    const { scheduler, advance } = setup({
      discoverFn: async () => { calls += 1; throw new Error('overpass down'); },
    });
    const r = scheduler.schedule(26.07, -80.25, 25);
    await assert.doesNotReject(r.promise);
    assert.equal(scheduler.schedule(26.07, -80.25, 25).status, 'failed', 'a failure is not reported as checked');
    advance(10 * 60000 + 1);
    const retry = scheduler.schedule(26.07, -80.25, 25);
    assert.equal(retry.status, 'started');
    await retry.promise;
    assert.equal(calls, 2);
  });

  it('reports a successful check over an overlapping earlier failure', async () => {
    let fail = true;
    const { scheduler } = setup({
      discoverFn: async () => { if (fail) throw new Error('timeout'); },
    });
    await scheduler.schedule(26.07, -80.25, 10).promise;
    assert.equal(scheduler.schedule(26.07, -80.25, 10).status, 'failed');
    fail = false;
    await scheduler.schedule(26.07, -80.25, 25).promise;
    assert.equal(scheduler.schedule(26.07, -80.25, 10).status, 'recent');
  });

  it('also contains synchronous throws from discoverFn', async () => {
    const { scheduler } = setup({ discoverFn: () => { throw new Error('boom'); } });
    const r = scheduler.schedule(1, 2, 3);
    assert.equal(r.status, 'started');
    await assert.doesNotReject(r.promise);
  });

  it('reset forgets recent and running areas', async () => {
    const { scheduler } = setup();
    await scheduler.schedule(26.07, -80.25, 25).promise;
    scheduler.reset();
    const r = scheduler.schedule(26.07, -80.25, 25);
    assert.equal(r.status, 'started');
    await r.promise;
  });
});
