const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const inr2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function fmtCr(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return `₹${inr.format(Math.round(n))} Cr`;
}

export function fmtRs(n: number | null | undefined, decimals: 0 | 1 | 2 = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  const f = decimals === 0 ? inr : decimals === 1 ? inr1 : inr2;
  return `₹${f.format(n)}`;
}

export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return `${n.toFixed(decimals)}%`;
}

export function fmtX(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return `${n.toFixed(decimals)}x`;
}

export function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(n);
}

/** YYYY-MM-DD -> "5 Nov 2026" (UTC so the date never shifts with the viewer's timezone). */
export function fmtDate(iso: string | undefined): string {
  if (!iso) return 'n/a';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** ISO timestamp -> "31 Oct 2026, 2:15 pm IST". */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const s = d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
  return `${s} IST`;
}

/** Hours since an ISO timestamp (Infinity when missing). */
export function hoursSince(iso: string | null | undefined, now = new Date()): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Infinity : (now.getTime() - t) / 3_600_000;
}
