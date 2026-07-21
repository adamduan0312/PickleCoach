/**
 * Private-court address visibility (DTO policy).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  approximateAreaFromAddress,
  shouldRevealPrivateCourtExactAddress,
  serializeCourtForPublicViewer,
  serializeCourtLocationForBooking,
  PRIVATE_COURT_ADDRESS_REVEAL_STATUSES,
} from '../utils/courtAddressVisibility.js';
import { serializeBookingListItem } from '../utils/bookingDto.js';
import { serializeCoachListItem } from '../utils/userDto.js';

describe('approximateAreaFromAddress', () => {
  it('strips the street line', () => {
    assert.equal(
      approximateAreaFromAddress('1234 Oak Lane, Coral Springs, FL 33065'),
      'Coral Springs, FL 33065',
    );
  });

  it('returns null when no city/state segment', () => {
    assert.equal(approximateAreaFromAddress('Backyard Court'), null);
    assert.equal(approximateAreaFromAddress(null), null);
  });
});

describe('shouldRevealPrivateCourtExactAddress', () => {
  it('always reveals public courts', () => {
    assert.equal(
      shouldRevealPrivateCourtExactAddress({ isPrivate: false, bookingStatus: 'pending' }),
      true,
    );
  });

  it('hides private courts when browsing (no booking)', () => {
    assert.equal(
      shouldRevealPrivateCourtExactAddress({ isPrivate: true, bookingStatus: null }),
      false,
    );
  });

  it('hides private courts while pending (authorized, not confirmed)', () => {
    assert.equal(
      shouldRevealPrivateCourtExactAddress({ isPrivate: true, bookingStatus: 'pending' }),
      false,
    );
  });

  it('reveals for confirmed and post-confirm statuses', () => {
    for (const status of PRIVATE_COURT_ADDRESS_REVEAL_STATUSES) {
      assert.equal(
        shouldRevealPrivateCourtExactAddress({ isPrivate: true, bookingStatus: status }),
        true,
        status,
      );
    }
  });

  it('does not reveal cancelled or pending even for students', () => {
    assert.equal(
      shouldRevealPrivateCourtExactAddress({ isPrivate: true, bookingStatus: 'cancelled' }),
      false,
    );
  });

  it('privileged viewers always see private exact address', () => {
    assert.equal(
      shouldRevealPrivateCourtExactAddress({
        isPrivate: true,
        bookingStatus: 'pending',
        viewerIsPrivileged: true,
      }),
      true,
    );
  });
});

describe('serializeCourtForPublicViewer', () => {
  it('keeps full address for public courts', () => {
    const out = serializeCourtForPublicViewer({
      id: 1,
      name: 'Central Park',
      address: '123 Main St, Miami, FL',
      latitude: 25.7,
      longitude: -80.2,
      is_private: false,
    });
    assert.equal(out.address, '123 Main St, Miami, FL');
    assert.equal(out.latitude, 25.7);
    assert.equal(out.area, 'Miami, FL');
  });

  it('redacts exact address and GPS for private courts; keeps area + distance', () => {
    const out = serializeCourtForPublicViewer(
      {
        id: 9,
        name: "John's Private Court",
        address: '1234 Oak Lane, Coral Springs, FL',
        latitude: 26.271,
        longitude: -80.27,
        is_private: true,
      },
      { searchLat: 26.27, searchLng: -80.27, includeId: false },
    );
    assert.equal(out.name, "John's Private Court");
    assert.equal(out.is_private, true);
    assert.equal(out.address, null);
    assert.equal(out.latitude, null);
    assert.equal(out.longitude, null);
    assert.equal(out.area, 'Coral Springs, FL');
    assert.equal(typeof out.distance_miles, 'number');
    assert.equal(out.id, undefined);
  });
});

describe('serializeCourtLocationForBooking', () => {
  const privateCourt = {
    id: 75,
    name: 'HOA Court',
    address: '9 Club Dr, Boca Raton, FL',
    latitude: 26.3,
    longitude: -80.1,
    is_private: true,
  };

  it('redacts for student on pending booking', () => {
    const out = serializeCourtLocationForBooking(privateCourt, {
      bookingStatus: 'pending',
      viewerIsPrivileged: false,
    });
    assert.equal(out.address, null);
    assert.equal(out.latitude, null);
    assert.equal(out.area, 'Boca Raton, FL');
  });

  it('reveals after confirmed for student', () => {
    const out = serializeCourtLocationForBooking(privateCourt, {
      bookingStatus: 'confirmed',
      viewerIsPrivileged: false,
    });
    assert.equal(out.address, '9 Club Dr, Boca Raton, FL');
    assert.equal(out.latitude, 26.3);
  });
});

/**
 * Canonical MVP matrix — keep this table in sync with API_ENDPOINTS.md address visibility.
 *
 * Court | User | Booking state | Exact address
 * ------|------|---------------|--------------
 * Public | Student | none | visible
 * Private | Student | none | hidden
 * Private | Student | pending | hidden
 * Private | Student | confirmed | visible **on booking DTO only**
 * Private | Student | cancelled (never confirmed) | hidden
 * Private | Coach owner | any | visible
 * Private | Admin | any | visible
 *
 * Coach discovery (`serializeCourtForPublicViewer` / GET /coaches/:id/courts) never
 * unlocks private exact location based on booking status.
 */
describe('MVP address visibility matrix', () => {
  const publicCourt = {
    id: 1,
    name: 'Central Park',
    address: '123 Main St, Miami, FL',
    latitude: 25.7,
    longitude: -80.2,
    is_private: false,
  };
  const privateCourt = {
    id: 9,
    name: 'Backyard',
    address: '1 Secret Rd, Coral Springs, FL',
    latitude: 26.2,
    longitude: -80.2,
    is_private: true,
  };

  function bookingRow(status, court) {
    return {
      id: 1,
      lesson_id: 1,
      coach_id: 7,
      primary_student_id: 2,
      scheduled_at: '2026-07-01T10:00:00.000Z',
      duration_minutes: 60,
      price: '50.00',
      status,
      court_location_id: court.id,
      messaging_locked: status !== 'confirmed',
      courtLocation: court,
    };
  }

  it('Public | Student | none → visible', () => {
    const out = serializeCourtForPublicViewer(publicCourt, { includeId: false });
    assert.equal(out.address, '123 Main St, Miami, FL');
    assert.equal(out.latitude, 25.7);
  });

  it('Private | Student | none → hidden', () => {
    const out = serializeCourtForPublicViewer(privateCourt, { includeId: false });
    assert.equal(out.address, null);
    assert.equal(out.latitude, null);
    assert.equal(out.longitude, null);
  });

  it('Private | Student | pending → hidden', () => {
    const out = serializeBookingListItem(bookingRow('pending', privateCourt), {
      viewerIsPrivileged: false,
    });
    assert.equal(out.courtLocation.address, null);
    assert.equal(out.courtLocation.latitude, null);
  });

  it('Private | Student | confirmed → visible', () => {
    const out = serializeBookingListItem(bookingRow('confirmed', privateCourt), {
      viewerIsPrivileged: false,
    });
    assert.equal(out.courtLocation.address, '1 Secret Rd, Coral Springs, FL');
    assert.equal(out.courtLocation.latitude, 26.2);
  });

  it('Private | Student | confirmed booking does NOT unlock coach courts discovery', () => {
    // Even with a confirmed booking elsewhere, coach-profile court list stays redacted.
    const out = serializeCourtForPublicViewer(privateCourt, { includeId: false });
    assert.equal(out.address, null);
    assert.equal(out.latitude, null);
    assert.equal(out.longitude, null);
  });

  it('Private | Student | cancelled without prior confirm → hidden', () => {
    const out = serializeBookingListItem(bookingRow('cancelled', privateCourt), {
      viewerIsPrivileged: false,
    });
    assert.equal(out.courtLocation.address, null);
    assert.equal(out.courtLocation.latitude, null);
  });

  it('Private | Coach owner | any → visible', () => {
    for (const status of ['pending', 'confirmed', 'cancelled']) {
      const out = serializeBookingListItem(bookingRow(status, privateCourt), {
        viewerIsPrivileged: true,
      });
      assert.equal(out.courtLocation.address, '1 Secret Rd, Coral Springs, FL', status);
    }
  });

  it('Private | Admin | any → visible', () => {
    // Admin uses the same privileged bypass as coach owner at the DTO boundary.
    for (const status of ['pending', 'cancelled']) {
      const out = serializeCourtLocationForBooking(privateCourt, {
        bookingStatus: status,
        viewerIsPrivileged: true,
      });
      assert.equal(out.address, '1 Secret Rd, Coral Springs, FL', status);
    }
  });
});

describe('DTO wiring', () => {
  it('coach list redacts private court street address', () => {
    const out = serializeCoachListItem({
      id: 1,
      full_name: 'Coach',
      timezone: 'UTC',
      coachProfile: { headline: 'H' },
      reliabilities: [],
      coachCourts: [
        {
          court: {
            name: 'Yard',
            address: '1 Secret Rd, Coral Springs, FL',
            latitude: 26.2,
            longitude: -80.2,
            is_private: true,
            deleted_at: null,
          },
        },
      ],
    });
    assert.equal(out.courts[0].address, null);
    assert.equal(out.courts[0].latitude, null);
    assert.equal(out.courts[0].area, 'Coral Springs, FL');
  });
});
