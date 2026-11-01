import { NextResponse } from 'next/server';
import { getEntries } from '@/lib/repo';
import { rate } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

/** GET /api/ipos -> every live/upcoming IPO with its listing data, and a score where one can be computed. */
export async function GET() {
  const res = await getEntries();
  if (res.state !== 'ok') {
    return NextResponse.json({ state: res.state, data: [] }, { status: res.state === 'error' ? 503 : 200 });
  }
  const data = res.entries.map((e) => {
    const r = e.ipo ? rate(e.ipo) : null;
    return {
      slug: e.listing.slug,
      name: e.listing.name,
      status: e.listing.status,
      segment: e.listing.segment,
      exchange: e.listing.exchange,
      openDate: e.listing.openDate,
      closeDate: e.listing.closeDate,
      priceBandLow: e.listing.priceBandLow,
      priceBandHigh: e.listing.priceBandHigh,
      lotSize: e.listing.lotSize,
      issueSizeCr: e.listing.issueSizeCr,
      subscriptionX: e.listing.subscriptionX,
      score: r?.score ?? null,
      band: r?.band ?? null,
      confidence: r?.confidence ?? null,
      modelVersion: r?.modelVersion ?? null,
      pendingReason: e.pendingReason,
      factors: r?.factors ?? null,
    };
  });
  return NextResponse.json({ state: 'ok', count: data.length, lastSuccessfulSync: res.sync?.lastSuccessAt ?? null, data });
}
