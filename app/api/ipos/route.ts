import { NextResponse } from 'next/server';
import { getIpoList } from '@/lib/ipos-repo';

export const dynamic = 'force-dynamic';

/** GET /api/ipos -> open and upcoming IPOs plus the latest closed ones, as stored by the daily sync. */
export async function GET() {
  const res = await getIpoList();
  if (res.state !== 'ok') {
    return NextResponse.json({ state: res.state, data: [] }, { status: res.state === 'error' ? 503 : 200 });
  }
  const data = res.ipos.map((i) => ({
    symbol: i.symbol,
    name: i.name,
    status: i.status,
    category: i.category,
    exchange: i.exchange,
    openDate: i.openDate,
    closeDate: i.closeDate,
    allotmentDate: i.allotmentDate,
    listingDate: i.listingDate,
    priceBand: i.priceBand,
    lotSize: i.lotSize,
    issueSizeCr: i.issueSizeCr,
    subscriptionX: i.subscriptionX,
    gmpAmount: i.gmpAmount,
    aiRating: i.rating,
    aiVerdict: i.verdict,
    aiSummary: i.research?.laymanSummary ?? null,
    aiGenerated: i.research !== null,
    updatedAt: i.updatedAt,
  }));
  return NextResponse.json({ state: 'ok', count: data.length, lastUpdatedAt: res.lastUpdatedAt, data });
}
