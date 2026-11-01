import type { SyncInfo } from '@/lib/repo';
import { fmtDateTime, hoursSince } from '@/lib/format';

/** Tells the reader how fresh the live data is, and says so loudly when it is not. */
export function SyncNotice({ sync }: { sync: SyncInfo | null }) {
  if (!sync || !sync.lastSuccessAt) {
    return (
      <div className="banner" role="status">
        <strong>No live data yet.</strong> The first sync from the exchange feed has not completed.
      </div>
    );
  }
  const stale = hoursSince(sync.lastSuccessAt) > 24;
  const failing = sync.lastRunOk === false;
  if (!stale && !failing) {
    return (
      <p className="faint" style={{ fontSize: 13, marginBottom: 14 }}>
        Live data last updated {fmtDateTime(sync.lastSuccessAt)}.
      </p>
    );
  }
  return (
    <div className="banner" role="status">
      <strong>{failing ? 'The latest update failed.' : 'Data may be out of date.'}</strong> Showing the last successful update from{' '}
      {fmtDateTime(sync.lastSuccessAt)}. Dates, price bands and subscription figures may have changed since.
    </div>
  );
}
