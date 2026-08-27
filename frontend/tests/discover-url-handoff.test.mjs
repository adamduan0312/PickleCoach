/**
 * Discover location query resolution + URL handoff (dashboard → Discover).
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  captureDiscoverUrlHandoff,
  markDiscoverUrlHandoffDone,
  peekDiscoverUrlHandoff,
  resetDiscoverUrlHandoff,
} from '../src/utils/discoverUrlHandoff.js';

describe('discover URL handoff', () => {
  beforeEach(() => {
    resetDiscoverUrlHandoff();
  });

  it('captures ?q= into a one-shot handoff', () => {
    const h = captureDiscoverUrlHandoff(new URLSearchParams('q=Weston%2C+FL'));
    assert.equal(h.q, 'Weston, FL');
    assert.equal(h.lat, null);
    assert.equal(h.done, false);
  });

  it('keeps in-flight handoff after URL is cleared (Strict Mode remount)', () => {
    const first = captureDiscoverUrlHandoff(new URLSearchParams('q=Davie%2C+FL'));
    assert.equal(first.q, 'Davie, FL');
    // Second mount sees empty URL but handoff still processing
    const second = captureDiscoverUrlHandoff(new URLSearchParams(''));
    assert.equal(second, first);
    assert.equal(second.done, false);
  });

  it('does not fall through to Near you while handoff is in flight', () => {
    captureDiscoverUrlHandoff(new URLSearchParams('q=Miami%2C+FL'));
    const empty = captureDiscoverUrlHandoff(new URLSearchParams(''));
    assert.ok(empty);
    assert.equal(empty.q, 'Miami, FL');
  });

  it('clears handoff when done so a clean /discover visit can use Near you', () => {
    captureDiscoverUrlHandoff(new URLSearchParams('q=Coral+Springs'));
    markDiscoverUrlHandoffDone();
    assert.equal(peekDiscoverUrlHandoff(), null);
    const clean = captureDiscoverUrlHandoff(new URLSearchParams(''));
    assert.equal(clean, null);
  });

  it('captures lat/lng GPS handoff', () => {
    const h = captureDiscoverUrlHandoff(
      new URLSearchParams('lat=26.1&lng=-80.2&label=Your+current+location'),
    );
    assert.equal(h.lat, 26.1);
    assert.equal(h.lng, -80.2);
    assert.equal(h.label, 'Your current location');
    assert.equal(h.q, null);
  });

  it('starts a new handoff when a fresh URL arrives after the previous one finished', () => {
    captureDiscoverUrlHandoff(new URLSearchParams('q=Old+Place'));
    markDiscoverUrlHandoffDone();
    const next = captureDiscoverUrlHandoff(new URLSearchParams('q=New+Place'));
    assert.equal(next.q, 'New Place');
    assert.equal(next.done, false);
  });

  it('shares one resolve promise across Strict Mode remounts', async () => {
    const { runDiscoverQHandoffOnce } = await import('../src/utils/discoverUrlHandoff.js');
    captureDiscoverUrlHandoff(new URLSearchParams('q=Miami%2C+FL'));
    let runs = 0;
    const runner = async () => {
      runs += 1;
      return 'ok';
    };
    const a = runDiscoverQHandoffOnce(runner);
    const b = runDiscoverQHandoffOnce(runner);
    assert.equal(await a, 'ok');
    assert.equal(await b, 'ok');
    assert.equal(runs, 1);
  });
});
