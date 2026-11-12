import { Link } from 'react-router-dom';
import { formatPoints } from './points';
import s from './academic-rating.module.css';

const maxRating = 1000;

export function AcademicRating({ rating, place, ownProfile, className }: {
  rating: number; place: number | null; ownProfile: boolean; className?: string;
}) {
  const placeLabel = place == null ? null : `${formatPoints(place)}-е место`;
  return <div className={[s.rating, className].filter(Boolean).join(' ')}>
    <dt className={s.heading}>
      <span>Академический рейтинг</span>
      {ownProfile && <Link to="/rating" className={s.place}
        aria-label={placeLabel ? `${placeLabel} в рейтинге` : undefined}>
        {placeLabel ?? 'Открыть рейтинг'}
        <span aria-hidden="true">→</span>
      </Link>}
    </dt>
    <dd className={s.value}>
      <div className={s.number}><strong>{rating}</strong> <small>/ {maxRating}</small></div>
      <meter className={s.meter} min={0} max={maxRating} value={rating} aria-label="Академический рейтинг" data-rating-scale />
    </dd>
  </div>;
}
