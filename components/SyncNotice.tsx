import { fmtDateTime, hoursSince } from '@/lib/format';

/** Tells the reader how fresh the data is, and says so loudly when it is not. The sync runs once a day. */
export function SyncNotice({ lastUpdatedAt }: { lastUpdatedAt: string | null }) {
  if (!lastUpdatedAt) {
    return (
      <div className="banner" role="status">
        <strong>No IPO data yet.</strong> The first daily update has not completed.
      </div>
    );
  }
  if (hoursSince(lastUpdatedAt) <= 36) {
    return (
      <p className="faint" style={{ fontSize: 13, marginBottom: 14 }}>
        Data last updated {fmtDateTime(lastUpdatedAt)}. Updated once a day.
      </p>
    );
  }
  return (
    <div className="banner" role="status">
      <strong>Data may be out of date.</strong> The last successful update was {fmtDateTime(lastUpdatedAt)}. Dates, price
      bands and subscription figures may have changed since.
    </div>
  );
}
