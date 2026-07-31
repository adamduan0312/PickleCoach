/**
 * Private-court address visibility (DTO policy) — structured address fields.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCourtArea,
  shouldRevealPrivateCourtExactAddress,
  serializeCourtForPublicViewer,
  serializeCourtLocationForBooking,
  PRIVATE_COURT_ADDRESS_REVEAL_STATUSES,
} from '../utils/courtAddressVisibility.js';
import { serializeBookingListItem } from '../utils/bookingDto.js';
import { serializeCoachListItem } from '../utils/userDto.js';

const publicCourt = {
  id: 1,
  name: 'Central Park',
  address_line1: '123 Main St',
  city: 'Miami',
  state: 'FL',
  postal_code: '33101',
  country: 'US',
  latitude: 25.7,
  longitude: -80.2,
  is_private: false,
};

const privateCourt = {
  id: 9,
  name: "John's Private Court",
  address_line1: '1234 Oak Lane',
  city: 'Coral Springs',
  state: 'FL',
  postal_code: '33065',
  country: 'US',
  latitude: 26.271,
  longitude: -80.27,
  is_private: true,
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
  it('public court returns full structured address', () => {
    const out = serializeCourtForPublicViewer(publicCourt);
    assert.equal(out.address_line1, '123 Main St');
    assert.equal(out.city, 'Miami');
    assert.equal(out.state, 'FL');
    assert.equal(out.postal_code, '33101');
    assert.equal(out.country, 'US');
    assert.equal(out.latitude, 25.7);
    assert.equal(out.area, 'Miami, FL 33101');
  });

  it('private court returns only area; hides structured fields and GPS', () => {
    const out = serializeCourtForPublicViewer(privateCourt, {
      searchLat: 26.27,
      searchLng: -80.27,
      includeId: false,
    });
    assert.equal(out.name, "John's Private Court");
    assert.equal(out.is_private, true);
    assert.equal(out.area, 'Coral Springs, FL 33065');
    assert.equal(out.address_line1, null);
    assert.equal(out.city, null);
    assert.equal(out.state, null);
    assert.equal(out.postal_code, null);
    assert.equal(out.country, null);
    assert.equal(out.latitude, null);
    assert.equal(out.longitude, null);
    assert.equal(typeof out.distance_miles, 'number');
    assert.equal(out.id, undefined);
  });

  it('private court still returns distance', () => {
    const out = serializeCourtForPublicViewer(privateCourt, {
      searchLat: 26.271,
      searchLng: -80.27,
    });
    assert.equal(out.distance_miles, 0);
    assert.equal(out.latitude, null);
  });
});

describe('serializeCourtLocationForBooking', () => {
  const bookingPrivate = {
    id: 75,
    name: 'HOA Court',
    address_line1: '9 Club Dr',
    city: 'Boca Raton',
    state: 'FL',
    postal_code: '33432',
    country: 'US',
    latitude: 26.3,
    longitude: -80.1,
    is_private: true,
  };

  it('pending booking redacts location', () => {
    const out = serializeCourtLocationForBooking(bookingPrivate, {
      bookingStatus: 'pending',
      viewerIsPrivileged: false,
    });
    assert.equal(out.address_line1, null);
    assert.equal(out.city, null);
    assert.equal(out.state, null);
    assert.equal(out.postal_code, null);
    assert.equal(out.latitude, null);
    assert.equal(out.area, 'Boca Raton, FL 33432');
  });

  it('confirmed booking reveals location', () => {
    const out = serializeCourtLocationForBooking(bookingPrivate, {
      bookingStatus: 'confirmed',
      viewerIsPrivileged: false,
    });
    assert.equal(out.address_line1, '9 Club Dr');
    assert.equal(out.city, 'Boca Raton');
    assert.equal(out.state, 'FL');
    assert.equal(out.postal_code, '33432');
    assert.equal(out.latitude, 26.3);
  });

  it('completed booking reveals location', () => {
    const out = serializeCourtLocationForBooking(bookingPrivate, {
      bookingStatus: 'completed',
      viewerIsPrivileged: false,
    });
    assert.equal(out.address_line1, '9 Club Dr');
  });

  it('disputed booking reveals location', () => {
    const out = serializeCourtLocationForBooking(bookingPrivate, {
      bookingStatus: 'disputed',
      viewerIsPrivileged: false,
    });
    assert.equal(out.address_line1, '9 Club Dr');
  });
});

/**
 * Canonical MVP matrix — keep this table in sync with API_ENDPOINTS.md address visibility.
 *
 * Court | User | Booking state | Exact address
 * ------|------|---------------|--------------
 * Public | Student | none | visible (structured)
 * Private | Student | none | area only
 * Private | Student | pending | area only
 * Private | Student | confirmed | visible **on booking DTO only**
 * Private | Student | cancelled (never confirmed) | area only
 * Private | Coach owner | any | visible
 * Private | Admin | any | visible
 */
describe('MVP address visibility matrix', () => {
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
    assert.equal(out.address_line1, '123 Main St');
    assert.equal(out.latitude, 25.7);
  });

  it('Private | Student | none → hidden', () => {
    const out = serializeCourtForPublicViewer(privateCourt, { includeId: false });
    assert.equal(out.address_line1, null);
    assert.equal(out.city, null);
    assert.equal(out.latitude, null);
    assert.equal(out.longitude, null);
    assert.equal(out.area, 'Coral Springs, FL 33065');
  });

  it('Private | Student | pending → hidden', () => {
    const out = serializeBookingListItem(bookingRow('pending', privateCourt), {
      viewerIsPrivileged: false,
    });
    assert.equal(out.courtLocation.address_line1, null);
    assert.equal(out.courtLocation.latitude, null);
  });

  it('Private | Student | confirmed → visible', () => {
    const out = serializeBookingListItem(bookingRow('confirmed', privateCourt), {
      viewerIsPrivileged: false,
    });
    assert.equal(out.courtLocation.address_line1, '1234 Oak Lane');
    assert.equal(out.courtLocation.city, 'Coral Springs');
    assert.equal(out.courtLocation.latitude, 26.271);
  });

  it('Private | Student | confirmed booking does NOT unlock coach courts discovery', () => {
    const out = serializeCourtForPublicViewer(privateCourt, { includeId: false });
    assert.equal(out.address_line1, null);
    assert.equal(out.latitude, null);
  });

  it('Private | Student | cancelled without prior confirm → hidden', () => {
    const out = serializeBookingListItem(bookingRow('cancelled', privateCourt), {
      viewerIsPrivileged: false,
    });
    assert.equal(out.courtLocation.address_line1, null);
    assert.equal(out.courtLocation.latitude, null);
  });

  it('Private | Coach owner | any → visible', () => {
    for (const status of ['pending', 'confirmed', 'cancelled']) {
      const out = serializeBookingListItem(bookingRow(status, privateCourt), {
        viewerIsPrivileged: true,
      });
      assert.equal(out.courtLocation.address_line1, '1234 Oak Lane', status);
    }
  });

  it('Private | Admin | any → visible', () => {
    for (const status of ['pending', 'cancelled']) {
      const out = serializeCourtLocationForBooking(privateCourt, {
        bookingStatus: status,
        viewerIsPrivileged: true,
      });
      assert.equal(out.address_line1, '1234 Oak Lane', status);
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
            address_line1: '1 Secret Rd',
            city: 'Coral Springs',
            state: 'FL',
            postal_code: '33065',
            country: 'US',
            latitude: 26.2,
            longitude: -80.2,
            is_private: true,
          },
        },
      ],
    });
    assert.equal(out.courts[0].address_line1, null);
    assert.equal(out.courts[0].city, null);
    assert.equal(out.courts[0].area, 'Coral Springs, FL 33065');
  });
});
