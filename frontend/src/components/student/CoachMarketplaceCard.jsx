import { Link } from 'react-router-dom';
import { Avatar } from '../ui/Avatar.jsx';
import { StarRating } from '../ui/StarRating.jsx';
import {
  discoverTeachingPlaceLabel,
  formatMilesAway,
  formatReliabilityHint,
  formatReliabilityLabel,
  formatSkillRatingLine,
  coachRatingCompactParts,
} from '../../utils/format.js';
import { FavoriteHeartButton } from './FavoriteHeartButton.jsx';

/**
 * The Discover coach card. Favorites reuses it. The heart sits outside the profile link.
 */
export function CoachMarketplaceCard({
  coach,
  hasLocation = false,
  toState = null,
  favorite = null,
  unavailable = false,
}) {
  const teachingLocation = discoverTeachingPlaceLabel(coach, { hasLocation });
  const distanceAway = hasLocation ? formatMilesAway(coach.distance_miles) : null;
  const skillLine = formatSkillRatingLine(coach.skill_rating, coach.rating_system);
  const reliabilityLine = formatReliabilityLabel(coach.reliability_score);
  const ratingParts = coachRatingCompactParts(coach.rating_average, coach.rating_count);

  const body = (
    <>
      <div className={`discover-coach-card-top${favorite ? ' has-favorite' : ''}`}>
        <Avatar name={coach.full_name} src={coach.avatar_url} size="lg" />
        <div className="discover-coach-card-identity">
          <h2 className="discover-coach-name">{coach.full_name}</h2>
          <p className="discover-coach-headline">{coach.headline || 'Pickleball coach'}</p>
          {(teachingLocation || distanceAway) ? (
            <p className="discover-coach-place">
              {teachingLocation ? <span>{teachingLocation}</span> : null}
              {teachingLocation && distanceAway ? <span aria-hidden="true"> · </span> : null}
              {distanceAway ? <span className="discover-coach-distance">{distanceAway}</span> : null}
            </p>
          ) : null}
        </div>
      </div>
      <ul className="discover-coach-stats" aria-label="Coach highlights">
        <li>
          <span className="discover-stat-label">Reviews</span>
          <span className="discover-stat-value">
            {ratingParts.hasReviews ? (
              <>
                {ratingParts.value}{' '}
                <StarRating variant="compact" />
                {' · '}
                {ratingParts.reviewLabel}
              </>
            ) : 'No reviews yet'}
          </span>
        </li>
        {skillLine ? (
          <li>
            <span className="discover-stat-label">Skill</span>
            <span className="discover-stat-value">{skillLine}</span>
          </li>
        ) : null}
        {reliabilityLine ? (
          <li title={formatReliabilityHint()}>
            <span className="discover-stat-label">Reliability</span>
            <span className="discover-stat-value">{reliabilityLine.replace(/^Reliability:\s*/i, '')}</span>
          </li>
        ) : null}
      </ul>
      {unavailable ? (
        <p className="muted small discover-coach-unavailable">This coach isn’t available right now.</p>
      ) : (
        <span className="btn secondary discover-card-cta">View profile</span>
      )}
    </>
  );

  const heart = favorite ? (
    <FavoriteHeartButton saved={favorite.saved} busy={favorite.busy} onClick={favorite.onToggle} />
  ) : null;

  if (unavailable) {
    return (
      <article className="card discover-coach-card discover-coach-card-wrap">
        {heart}
        {body}
      </article>
    );
  }

  return (
    <div className="discover-coach-card-wrap">
      {heart}
      <Link
        to={`/coaches/${coach.id}`}
        state={toState || undefined}
        className="card clickable discover-coach-card"
      >
        {body}
      </Link>
    </div>
  );
}
