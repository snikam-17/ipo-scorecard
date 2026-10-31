import { NextResponse } from 'next/server';
import { getAllIpos } from '@/lib/repo';
import { rate } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

/** GET /api/ipos -> every IPO with its score and the factor breakdown. */
export async function GET() {
  const { ipos, source } = await getAllIpos();
  const data = ipos.map((ipo) => {
    const r = rate(ipo);
    return {
      slug: ipo.slug,
      name: ipo.name,
      dataSource: ipo.dataSource,
      openDate: ipo.issue.openDate,
      closeDate: ipo.issue.closeDate,
      score: r.score,
      band: r.band,
      confidence: r.confidence,
      modelVersion: r.modelVersion,
      factors: r.factors,
    };
  });
  return NextResponse.json({ source, count: data.length, data });
}
