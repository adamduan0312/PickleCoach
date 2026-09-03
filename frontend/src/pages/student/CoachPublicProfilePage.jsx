import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { coachesApi, asList } from '../../api/index.js';
import { useAsync } from '../../hooks/useAsync.js';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { StarRating } from '../../components/ui/StarRating.jsx';
import {
  formatMoney,
  courtLabel,
  formatSkillRatingLine,
  formatReliabilityLabel,
  formatReliabilityHint,
  teachingLocationLabel,
  coachReviewSummary,
  coachRatingCompactParts,
} from '../../utils/format.js';
import {
  buildAvailabilitySlots,
  groupSlotsByDate,
  formatDateInZone,
  formatTimeInZone,
  detectLocalTimezone,
  AVAILABILITY_LOOKAHEAD_DAYS,
  AVAILABILITY_INITIAL_SLOT_COUNT,
  AVAILABILITY_SLOT_PAGE_SIZE,
} from '../../utils/datetime.js';
import { useAuth } from '../../auth/AuthContext.jsx';

function courtTeachingLabel(court) {
  const name = court?.name || 'Court';
  const area = teachingLocationLabel(court);
  return area ? `${name} · ${area}` : courtLabel(court);
}

function reviewStudentName(review) {
  return review?.student?.full_name || review?.reviewer_name || null;
}

function reviewRatingValue(review) {
  const n = Number(review?.rating);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function CoachPublicProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const viewerTz = user?.timezone || detectLocalTimezone();
  const [lessonId, setLessonId] = useState('');
  const [courtId, setCourtId] = useState('');
  const [slotIso, setSlotIso] = useState('');
  const [visibleSlotCount, setVisibleSlotCount] = useState(AVAILABILITY_INITIAL_SLOT_COUNT);

  const { data, error, loading } = useAsync(async () => {
    const [coachRes, lessonsRes, courtsRes, availabilityRes, reviewsRes] = await Promise.all([
      coachesApi.getById(id),
      coachesApi.getLessons(id).catch(() => ({ data: [] })),
      coachesApi.getCourts(id).catch(() => ({ data: [] })),
      coachesApi.getAvailability(id).catch(() => ({ data: [] })),
      coachesApi.getReviews(id).catch(() => ({ data: [] })),
    ]);
    return {
      coach: coachRes.data,
      lessons: asList(lessonsRes.data).length ? asList(lessonsRes.data) : asList(coachRes.data?.lessons),
      courts: asList(courtsRes.data),
      availability: asList(availabilityRes.data).length ? asList(availabilityRes.data) : asList(coachRes.data?.availabilities),
      reviews: asList(reviewsRes.data).length ? asList(reviewsRes.data) : asList(coachRes.data?.reviewsReceived),
    };
  }, [id]);

  const selectedLesson = (data?.lessons || []).find((l) => String(l.id) === String(lessonId));
  const selectedCourt = (data?.courts || []).find((c) => String(c.court_id || c.id) === String(courtId));
  const isOwnProfile = user?.id != null && String(user.id) === String(id);

  const slots = useMemo(() => {
    if (!data || !selectedLesson) return [];
    return buildAvailabilitySlots({
      availabilities: data.availability,
      durationMinutes: selectedLesson.duration_minutes,
      coachTimezone: data.coach?.timezone || 'UTC',
      daysAhead: AVAILABILITY_LOOKAHEAD_DAYS,
    });
  }, [data, selectedLesson]);

  const visibleSlots = useMemo(
    () => slots.slice(0, visibleSlotCount),
    [slots, visibleSlotCount],
  );
  const slotGroups = useMemo(
    () => groupSlotsByDate(visibleSlots, viewerTz),
    [visibleSlots, viewerTz],
  );
  const hasMoreSlots = visibleSlotCount < slots.length;

  function selectLesson(nextId) {
    setLessonId(String(nextId));
    setCourtId('');
    setSlotIso('');
    setVisibleSlotCount(AVAILABILITY_INITIAL_SLOT_COUNT);
  }

  function selectCourt(nextId) {
    setCourtId(String(nextId));
    setSlotIso('');
  }

  function showMoreSlots() {
    setVisibleSlotCount((n) => Math.min(n + AVAILABILITY_SLOT_PAGE_SIZE, slots.length));
  }

  function continueBooking() {
    if (isOwnProfile || !lessonId || !courtId || !slotIso) return;
    const q = new URLSearchParams({ lesson: lessonId, court: courtId, at: slotIso });
    navigate(`/book/${id}/checkout?${q.toString()}`);
  }

  if (loading) return <div className="page"><LoadingState label="Loading coach…" /></div>;
  if (error) return <div className="page"><ErrorState error={error} /></div>;
  if (!data?.coach) return <div className="page"><EmptyState title="Coach not found" /></div>;

  const coach = data.coach;
  const profile = coach.coachProfile || {};
  const skillLine = formatSkillRatingLine(profile.skill_rating, profile.rating_system);
  const reliabilityLine = formatReliabilityLabel(coach.reliability?.reliability_score);
  const listedReviews = data.reviews || [];
  const profileSummary = coachReviewSummary(profile.rating_average, profile.rating_count);
  let hasReviews = profileSummary.hasReviews;
  let ratingAverage = profileSummary.ratingAverage;
  let reviewCount = profileSummary.reviewCount;
  if (!hasReviews && listedReviews.length > 0) {
    reviewCount = listedReviews.length;
    ratingAverage = listedReviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / listedReviews.length;
    hasReviews = Number.isFinite(ratingAverage) && reviewCount > 0;
  }
  const ratingParts = coachRatingCompactParts(ratingAverage, reviewCount);
  const canBook = !isOwnProfile && data.lessons.length > 0;
  const bookingReady = Boolean(lessonId && courtId && slotIso);

  return (
    <div className="page coach-profile-page">
      <section className="card coach-profile-hero">
        <div className="coach-profile-hero-top">
          <Avatar name={coach.full_name} src={coach.avatar_url} size="lg" />
          <div className="coach-profile-hero-identity">
            <h1>{coach.full_name}</h1>
            <p className="coach-profile-headline">{profile.headline || 'Pickleball coach'}</p>
            <ul className="coach-profile-highlights" aria-label="Coach highlights">
              <li>
                <span className="coach-highlight-label">Reviews</span>
                {hasReviews ? (
                  <div className="coach-profile-rating-display">
                    <span className="coach-rating-score">{ratingAverage.toFixed(1)} / 5</span>
                    <StarRating rating={ratingAverage} className="coach-profile-stars" />
                    <span className="coach-rating-count">
                      {reviewCount} review{reviewCount === 1 ? '' : 's'}
                    </span>
                  </div>
                ) : (
                  <span>No reviews yet</span>
                )}
              </li>
              {skillLine ? (
                <li>
                  <span className="coach-highlight-label">Skill</span>
                  <span>{skillLine}</span>
                </li>
              ) : null}
              {reliabilityLine ? (
                <li title={formatReliabilityHint()}>
                  <span className="coach-highlight-label">Reliability</span>
                  <span>{reliabilityLine.replace(/^Reliability:\s*/i, '')}</span>
                </li>
              ) : null}
              {profile.location ? (
                <li>
                  <span className="coach-highlight-label">Based in</span>
                  <span>{profile.location}</span>
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      </section>

      {(profile.bio || profile.certifications) ? (
        <section className="card coach-profile-section">
          <h2>About</h2>
          {profile.bio ? <p className="coach-profile-bio">{profile.bio}</p> : null}
          {profile.certifications ? (
            <p className="small muted">Certifications: {profile.certifications}</p>
          ) : null}
        </section>
      ) : null}

      {data.courts.length > 0 ? (
        <section className="card coach-profile-section">
          <h2>Teaching locations</h2>
          <p className="muted small coach-section-intro">
            Places where you can take a lesson with this coach.
          </p>
          <ul className="coach-teaching-locations">
            {data.courts.map((c) => {
              const cid = c.court_id || c.id;
              return (
                <li key={cid}>
                  <span className="coach-teaching-pin" aria-hidden="true">
                    <svg className="coach-teaching-pin-icon" viewBox="0 0 24 24" width="16" height="16" focusable="false">
                      <path
                        fill="currentColor"
                        d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"
                      />
                    </svg>
                  </span>
                  <span>{courtTeachingLabel(c)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="card coach-profile-section coach-booking-section">
        <h2>Book a lesson</h2>
        {isOwnProfile ? (
          <Alert tone="info">
            This is your coach profile. Students book you from Discover — you can’t book yourself.
          </Alert>
        ) : null}

        {data.lessons.length === 0 ? (
          <EmptyState title="No bookable lessons" detail="This coach is not currently offering marketplace lessons." />
        ) : (
          <div className="coach-booking-flow">
            <div className="coach-booking-step">
              <h3 className="coach-booking-step-title">1. Choose a lesson</h3>
              <div className="coach-lesson-cards">
                {data.lessons.map((l) => {
                  const selected = String(l.id) === String(lessonId);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      className={`coach-lesson-card${selected ? ' selected' : ''}`}
                      onClick={() => selectLesson(l.id)}
                      disabled={isOwnProfile}
                    >
                      <div className="coach-lesson-card-main">
                        <strong>{l.title}</strong>
                        {l.description ? (
                          <p className="small muted coach-lesson-desc">{l.description}</p>
                        ) : null}
                      </div>
                      <div className="coach-lesson-card-meta">
                        <span>{l.duration_minutes} min</span>
                        <strong>{formatMoney(l.price)}</strong>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedLesson ? (
              <div className="coach-booking-step">
                <h3 className="coach-booking-step-title">2. Choose where</h3>
                {data.courts.length === 0 ? (
                  <EmptyState title="No teaching locations" detail="This coach has not linked any courts yet." />
                ) : (
                  <div className="coach-court-cards">
                    {data.courts.map((c) => {
                      const cid = c.court_id || c.id;
                      const selected = String(cid) === String(courtId);
                      return (
                        <button
                          key={cid}
                          type="button"
                          className={`coach-court-card${selected ? ' selected' : ''}`}
                          onClick={() => selectCourt(cid)}
                          disabled={isOwnProfile}
                        >
                          {courtTeachingLabel(c)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {selectedLesson && courtId ? (
              <div className="coach-booking-step">
                <h3 className="coach-booking-step-title">3. Choose when</h3>
                <p className="small muted coach-section-intro">
                  Next available times in your timezone ({viewerTz}). Coach timezone: {coach.timezone || 'UTC'}.
                </p>
                {slots.length === 0 ? (
                  <EmptyState
                    title="No upcoming slots"
                    detail={`This coach has availability windows, but none in the next ${AVAILABILITY_LOOKAHEAD_DAYS} days — or none that fit this lesson length.`}
                  />
                ) : (
                  <>
                    <div className="slot-day-list">
                      {slotGroups.map((group) => (
                        <div key={group.dateKey} className="slot-day-group">
                          <h4 className="slot-day-heading">{group.dateLabel}</h4>
                          <div className="slot-grid slot-grid-times">
                            {group.slots.map((s) => (
                              <button
                                type="button"
                                key={s.scheduled_at}
                                className={`slot${slotIso === s.scheduled_at ? ' selected' : ''}`}
                                onClick={() => setSlotIso(s.scheduled_at)}
                                disabled={isOwnProfile}
                              >
                                <strong>{formatTimeInZone(s.scheduled_at, viewerTz)}</strong>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {hasMoreSlots ? (
                      <button
                        type="button"
                        className="btn secondary slot-see-more"
                        onClick={showMoreSlots}
                        disabled={isOwnProfile}
                      >
                        See more times
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {bookingReady ? (
              <div className="coach-booking-summary card">
                <h3 className="coach-booking-step-title">Your selection</h3>
                <dl className="booking-summary-list">
                  <div>
                    <dt>Lesson</dt>
                    <dd>{selectedLesson.title} · {selectedLesson.duration_minutes} min · {formatMoney(selectedLesson.price)}</dd>
                  </div>
                  <div>
                    <dt>Where</dt>
                    <dd>{courtTeachingLabel(selectedCourt)}</dd>
                  </div>
                  <div>
                    <dt>When</dt>
                    <dd>
                      {formatDateInZone(slotIso, viewerTz)} · {formatTimeInZone(slotIso, viewerTz)}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : null}

            <button
              className="btn coach-booking-cta"
              type="button"
              disabled={!canBook || !bookingReady}
              onClick={continueBooking}
            >
              Continue to checkout
            </button>
          </div>
        )}
      </section>

      <section className="card coach-profile-section">
        <h2>What students say</h2>
        {listedReviews.length > 0 ? (
          <div className="stack coach-reviews">
            {listedReviews.slice(0, 8).map((r) => {
              const studentName = reviewStudentName(r);
              const ratingValue = reviewRatingValue(r);
              const comment = typeof r.comment === 'string' ? r.comment.trim() : '';
              return (
                <article key={r.id || r.created_at} className="coach-review">
                  <div className="coach-review-header">
                    {studentName ? <strong>{studentName}</strong> : null}
                    {r.created_at ? (
                      <time className="small muted" dateTime={r.created_at}>
                        {formatDateInZone(r.created_at, viewerTz)}
                      </time>
                    ) : null}
                  </div>
                  {ratingValue != null ? (
                    <div className="coach-review-rating">
                      <StarRating rating={ratingValue} />
                    </div>
                  ) : null}
                  {comment ? <p className="coach-review-comment">{comment}</p> : null}
                </article>
              );
            })}
          </div>
        ) : hasReviews ? (
          <p className="muted" style={{ margin: 0 }}>
            {ratingParts.hasReviews ? (
              <>
                {ratingParts.value}{' '}
                <StarRating variant="compact" />
                {' · '}
                {ratingParts.reviewLabel}
              </>
            ) : null}
            . Individual review comments aren’t listed on this profile yet.
          </p>
        ) : (
          <EmptyState title="No reviews yet" detail="Reviews from students will show up here after completed lessons." />
        )}
      </section>

      <p className="small muted" style={{ marginTop: 16 }}>
        <Link to="/discover">Back to Discover</Link>
      </p>
    </div>
  );
}
