/**
 * Court DTO helpers — every court returns its full structured address.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCourtArea,
  serializeCourtForPublicViewer,
  serializeCourtLocationForBooking,
} from '../utils/courtDto.js';
import { serializeBookingListItem } from '../utils/bookingDto.js';
import { serializeCoachListItem } from '../utils/userDto.js';

const court = {
  id: 1,
  name: 'Central Park',
  address_line1: '123 Main St',
  city: 'Miami',
  state: 'FL',
  postal_code: '33101',
  country: 'US',
  latitude: 25.7,
  longitude: -80.2,
};

describe('buildCourtArea', () => {
  it('returns City, ST ZIP', () => {
    assert.equal(
      buildCourtArea({ city: 'Coral Springs', state: 'FL', postal_code: '33065' }),
      'Coral Springs, FL 33065',
    );
  });

  it('returns null when any component is missing', () => {
    assert.equal(buildCourtArea({ city: 'Coral Springs', state: 'FL' }), null);
    assert.equal(buildCourtArea(null), null);
  });
});

describe('serializeCourtForPublicViewer', () => {
  it('returns full structured address, area and coordinates', () => {
    const out = serializeCourtForPublicViewer(court);
    assert.equal(out.id, 1);
    assert.equal(out.address_line1, '123 Main St');
    assert.equal(out.city, 'Miami');
    assert.equal(out.state, 'FL');
    assert.equal(out.postal_code, '33101');
    assert.equal(out.country, 'US');
    assert.equal(out.latitude, 25.7);
    assert.equal(out.longitude, -80.2);
    assert.equal(out.area, 'Miami, FL 33101');
    assert.equal('is_private' in out, false);
  });

  it('adds distance from a search origin and honors key options', () => {
    const out = serializeCourtForPublicViewer(court, {
      searchLat: 25.7,
      searchLng: -80.2,
      includeId: true,
      idKey: 'court_id',
      latKey: 'lat',
      lngKey: 'lng',
    });
    assert.equal(out.court_id, 1);
    assert.equal(out.lat, 25.7);
    assert.equal(out.lng, -80.2);
    assert.equal(out.distance_miles, 0);
  });

  it('omits id when includeId is false', () => {
    assert.equal(serializeCourtForPublicViewer(court, { includeId: false }).id, undefined);
  });
});

describe('serializeCourtLocationForBooking', () => {
  it('returns the full address for every booking status', () => {
    const out = serializeCourtLocationForBooking(court);
    assert.equal(out.id, 1);
    assert.equal(out.address_line1, '123 Main St');
    assert.equal(out.area, 'Miami, FL 33101');
    assert.equal(out.latitude, 25.7);
    assert.equal('is_private' in out, false);
  });

  it('pending booking list item shows the exact address', () => {
    const out = serializeBookingListItem({
      id: 1,
      lesson_id: 1,
      coach_id: 7,
      primary_student_id: 2,
      scheduled_at: '2026-07-01T10:00:00.000Z',
      duration_minutes: 60,
      price: '50.00',
      status: 'pending',
      court_location_id: court.id,
      courtLocation: court,
    });
    assert.equal(out.courtLocation.address_line1, '123 Main St');
    assert.equal(out.courtLocation.latitude, 25.7);
  });
});

describe('DTO wiring', () => {
  it('coach list returns the court street address', () => {
    const out = serializeCoachListItem({
      id: 1,
      full_name: 'Coach',
      timezone: 'UTC',
      coachProfile: { headline: 'H' },
      reliabilities: [],
      coachCourts: [{ court }],
    });
    assert.equal(out.courts[0].address_line1, '123 Main St');
    assert.equal(out.courts[0].area, 'Miami, FL 33101');
  });
});
