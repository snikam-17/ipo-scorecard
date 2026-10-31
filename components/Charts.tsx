'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { FinancialYear, Peer } from '@/lib/types';

/* Colours are the validated categorical slots, assigned in fixed order:
   1 blue, 2 orange, 3 aqua. Defined as CSS variables in globals.css (light + dark). */
const C1 = 'var(--s1)';
const C2 = 'var(--s2)';
const C3 = 'var(--s3)';

const axis = { stroke: 'var(--ink-3)', fontSize: 12 };
const tooltipStyle = {
  background: 'var(--panel)',
  border: '1px solid var(--rule-strong)',
  borderRadius: 6,
  color: 'var(--ink)',
  fontSize: 13,
};

const crFmt = (v: unknown) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`;
const pctFmt = (v: unknown) => `${Number(v).toFixed(1)}%`;

export function FinancialsChart({ data }: { data: FinancialYear[] }) {
  return (
    <div>
      <div className="chart-title">Revenue, EBITDA and profit after tax</div>
      <div className="chart-note">₹ crore, by financial year. Negative values are losses.</div>
      <ResponsiveContainer width="100%" height={290}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid stroke="var(--rule)" vertical={false} />
          <XAxis dataKey="fy" {...axis} tickLine={false} axisLine={{ stroke: 'var(--rule-strong)' }} />
          <YAxis {...axis} tickLine={false} axisLine={false} width={48} />
          <Tooltip contentStyle={tooltipStyle} formatter={crFmt} cursor={{ fill: 'var(--canvas)' }} />
          <Legend iconType="square" wrapperStyle={{ fontSize: 13, color: 'var(--ink-2)' }} />
          <Bar dataKey="revenue" name="Revenue" fill={C1} radius={[4, 4, 0, 0]} maxBarSize={36} />
          <Bar dataKey="ebitda" name="EBITDA" fill={C2} radius={[4, 4, 0, 0]} maxBarSize={36} />
          <Bar dataKey="pat" name="PAT" fill={C3} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MarginsChart({ data }: { data: FinancialYear[] }) {
  const rows = data.map((d) => ({
    fy: d.fy,
    ebitdaMargin: d.revenue > 0 ? (d.ebitda / d.revenue) * 100 : null,
    patMargin: d.revenue > 0 ? (d.pat / d.revenue) * 100 : null,
    roe: d.netWorth > 0 ? (d.pat / d.netWorth) * 100 : null,
  }));
  return (
    <div>
      <div className="chart-title">Margins and return on equity</div>
      <div className="chart-note">Percent, by financial year.</div>
      <ResponsiveContainer width="100%" height={290}>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--rule)" vertical={false} />
          <XAxis dataKey="fy" {...axis} tickLine={false} axisLine={{ stroke: 'var(--rule-strong)' }} />
          <YAxis {...axis} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} />
          <Tooltip contentStyle={tooltipStyle} formatter={pctFmt} />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 13, color: 'var(--ink-2)' }} />
          <Line type="monotone" dataKey="ebitdaMargin" name="EBITDA margin" stroke={C1} strokeWidth={2} dot={{ r: 4, stroke: 'var(--panel)', strokeWidth: 2 }} connectNulls />
          <Line type="monotone" dataKey="patMargin" name="PAT margin" stroke={C2} strokeWidth={2} dot={{ r: 4, stroke: 'var(--panel)', strokeWidth: 2 }} connectNulls />
          <Line type="monotone" dataKey="roe" name="Return on equity" stroke={C3} strokeWidth={2} dot={{ r: 4, stroke: 'var(--panel)', strokeWidth: 2 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

type PeerMetric = 'pe' | 'pb' | 'roe';

const PEER_META: Record<PeerMetric, { title: string; note: string; suffix: string }> = {
  pe: { title: 'Price to earnings', note: 'At upper price band. Blank = loss-making.', suffix: 'x' },
  pb: { title: 'Price to book', note: 'At upper price band.', suffix: 'x' },
  roe: { title: 'Return on equity', note: 'Latest financial year.', suffix: '%' },
};

export function PeerBars({
  metric,
  company,
  value,
  peers,
}: {
  metric: PeerMetric;
  company: string;
  value: number | null;
  peers: Peer[];
}) {
  const meta = PEER_META[metric];
  const rows = [
    { name: company, v: value, self: true },
    ...peers.map((p) => ({ name: p.name, v: p[metric], self: false })),
  ].map((r) => ({ ...r, v: r.v === null ? undefined : Number(r.v.toFixed(1)) }));

  return (
    <div>
      <div className="chart-title">{meta.title}</div>
      <div className="chart-note">{meta.note}</div>
      <ResponsiveContainer width="100%" height={36 * rows.length + 30}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 40, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid stroke="var(--rule)" horizontal={false} />
          <XAxis type="number" {...axis} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}${meta.suffix}`} />
          <YAxis type="category" dataKey="name" {...axis} tickLine={false} axisLine={{ stroke: 'var(--rule-strong)' }} width={118} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}${meta.suffix}`} cursor={{ fill: 'var(--canvas)' }} />
          <Bar dataKey="v" name={meta.title} radius={[0, 4, 4, 0]} maxBarSize={20} label={{ position: 'right', fill: 'var(--ink-2)', fontSize: 12, formatter: (v: unknown) => `${v}${meta.suffix}` }}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.self ? C1 : 'var(--peer)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
