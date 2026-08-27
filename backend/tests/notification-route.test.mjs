/**
 * Notification payload.route deep links for client navigation.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { notificationRouteFor, withNotificationRoute } from '../notifications/notificationRoutes.js';
import { serializeNotification } from '../utils/notificationDto.js';

describe('notificationRouteFor', () => {
  it('new_message → /messages/:conversation_id', () => {
    assert.equal(
      notificationRouteFor('new_message', { conversation_id: 42, booking_id: 5 }),
      '/messages/42',
    );
  });

  it('booking types → /bookings/:booking_id', () => {
    for (const type of [
      'booking_confirmed',
      'booking_declined',
      'booking_cancelled',
      'booking_request_coach',
      'pre_lesson_24h',
      'student_no_show',
      'coach_no_show',
      'dispute_opened',
      'dispute_resolved',
    ]) {
      assert.equal(notificationRouteFor(type, { booking_id: 99 }), '/bookings/99', type);
    }
  });

  it('returns null when no deep-link ids', () => {
    assert.equal(notificationRouteFor('password_reset', { headline: 'Reset' }), null);
  });

  it('prefers explicit payload.route over derived paths', () => {
    assert.equal(
      notificationRouteFor('review_received', { booking_id: 81, route: '/reviews/15' }),
      '/reviews/15',
    );
    assert.equal(
      notificationRouteFor('dispute_resolved', { booking_id: 81, route: '/disputes/21' }),
      '/disputes/21',
    );
    assert.equal(
      notificationRouteFor('new_message', {
        conversation_id: 42,
        route: '/reviews',
      }),
      '/reviews',
    );
  });
});

describe('withNotificationRoute', () => {
  it('adds route without clobbering existing route', () => {
    const added = withNotificationRoute('new_message', { conversation_id: 7 });
    assert.equal(added.route, '/messages/7');

    const kept = withNotificationRoute('new_message', {
      conversation_id: 7,
      route: '/custom/path',
    });
    assert.equal(kept.route, '/custom/path');
  });

  it('passes through explicit route for future notification types', () => {
    const out = withNotificationRoute('review_received', {
      booking_id: 81,
      route: '/reviews/15',
      headline: 'New review',
    });
    assert.equal(out.route, '/reviews/15');
  });
});

describe('serializeNotification enriches route', () => {
  it('adds route for legacy rows missing payload.route', () => {
    const out = serializeNotification({
      id: 1,
      user_id: 2,
      type: 'new_message',
      channel: 'in_app',
      payload: {
        conversation_id: 42,
        headline: 'New message',
        summary: 'John: Sounds good!',
      },
      status: 'sent',
      read_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(out.payload.route, '/messages/42');
    assert.equal(out.payload.headline, 'New message');
  });

  it('adds booking route for booking_confirmed', () => {
    const out = serializeNotification({
      id: 2,
      user_id: 3,
      type: 'booking_confirmed',
      channel: 'in_app',
      payload: { booking_id: 15, coach_name: 'Alex' },
      status: 'sent',
    });
    assert.equal(out.payload.route, '/bookings/15');
  });

  it('preserves explicit payload.route on read', () => {
    const out = serializeNotification({
      id: 4,
      user_id: 3,
      type: 'dispute_resolved',
      channel: 'in_app',
      payload: { booking_id: 81, route: '/disputes/21', headline: 'Dispute resolved' },
      status: 'sent',
    });
    assert.equal(out.payload.route, '/disputes/21');
  });
});
