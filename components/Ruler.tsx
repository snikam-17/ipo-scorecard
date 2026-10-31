/** The one 0-10 scale used for every score on the site. Zones: <3.5, 3.5-5, 5-6.5, >=6.5. */

export type Tone = 'good' | 'ok' | 'bad' | 'na';

export function toneFor(score: number | null): Tone {
  if (score === null) return 'na';
  if (score >= 6.5) return 'good';
  if (score >= 5) return 'ok';
  return 'bad';
}

export function Ruler({ score, size = 'lg', label }: { score: number | null; size?: 'lg' | 'sm'; label?: string }) {
  const tone = toneFor(score);
  return (
    <div>
      <div
        className={`ruler ${size === 'sm' ? 'sm' : ''}`}
        role="img"
        aria-label={label ?? (score === null ? 'No score' : `Score ${score} out of 10`)}
      >
        {[35, 50, 65].map((t) => (
          <span key={t} className="tick" style={{ left: `${t}%` }} />
        ))}
        {score !== null && <span className={`mark tone-${tone}-bg`} style={{ left: `${Math.min(Math.max(score, 0), 10) * 10}%` }} />}
      </div>
      {size === 'lg' && (
        <div className="ruler-scale" aria-hidden="true">
          <span>0</span>
          <span>3.5</span>
          <span>5</span>
          <span>6.5</span>
          <span>10</span>
        </div>
      )}
    </div>
  );
}
