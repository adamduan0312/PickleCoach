import { formatMoney } from '../../utils/format.js';

/**
 * Shared My Bookings / coach schedule list card body.
 * Hierarchy: lesson title → party + price → lesson when → requested → deadline.
 */
export function BookingListCardBody({
  lessonTitle = 'Lesson',
  partyName,
  price,
  lessonWhen,
  requestedWhen,
  deadlineWhen,
  audience = 'student',
  children,
}) {
  return (
    <div className="booking-list-card-body">
      <div className="booking-list-card-title">{lessonTitle}</div>
      <div className="booking-list-card-party">
        {partyName || '—'} · {formatMoney(price)}
      </div>
      <div className="booking-list-card-when">{lessonWhen}</div>
      {requestedWhen ? (
        <div className="booking-list-card-requested">Requested {requestedWhen}</div>
      ) : null}
      {deadlineWhen ? (
        <div className="booking-list-card-deadline">
          {audience === 'coach'
            ? <>Respond by {deadlineWhen}</>
            : <>Coach has until {deadlineWhen} to accept or decline</>}
        </div>
      ) : null}
      {children}
    </div>
  );
}
