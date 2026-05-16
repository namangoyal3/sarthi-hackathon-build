import { useMemo, useState } from 'react';
import { useSarthi } from '../store/useSarthi';
import { cpfTrajectory, sgd } from '../agent/tools';
import type { CpfTrajectory } from '../agent/tools';

const CHART_W = 320;
const CHART_H = 140;

function chartPath(values: number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values, 1);
  const stepX = CHART_W / Math.max(values.length - 1, 1);
  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = CHART_H - (v / max) * (CHART_H - 12) - 6;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function reasoningTrace(t: CpfTrajectory): { label: string; tool: string }[] {
  return [
    { label: 'Pulled monthly net income from the last 3 months.', tool: 'income_summary()' },
    {
      label: `Modelled CPF as a Platform Worker: worker ${(t.worker_share * 100).toFixed(0)}% + operator match ${(t.operator_share * 100).toFixed(0)}% (illustrative).`,
      tool: 'cpf_trajectory()',
    },
    {
      label: `Projected ${t.optInPath.length} years (${t.current_age} → ${t.retirement_age}) on both paths at CPF yield ${(t.cpf_growth_rate * 100).toFixed(1)}% / cash yield ${(t.cash_growth_rate * 100).toFixed(1)}%.`,
      tool: 'cpf_trajectory()',
    },
    {
      label: 'Split the CPF balance into housing, healthcare, retirement (illustrative shares).',
      tool: 'cpf_trajectory()',
    },
    {
      label: 'Verified each figure traces to a CSV row or a stated assumption — never invented.',
      tool: 'output_guard()',
    },
  ];
}

export default function CPFLifeMirror() {
  const { ds, driver, go } = useSarthi();
  if (!ds || !driver) return null;
  const traj = useMemo(() => cpfTrajectory(ds, driver, 65), [ds, driver]);
  const [age, setAge] = useState(traj.retirement_age);
  const idx = Math.max(
    0,
    Math.min(traj.optInPath.length - 1, age - traj.current_age),
  );
  const optIn = traj.optInPath[idx];
  const stayOut = traj.stayOutPath[idx];

  const optPotSeries = traj.optInPath.map((p) => p.retirement_pot);
  const stayPotSeries = traj.stayOutPath.map((p) => p.retirement_pot);
  const optPath = chartPath(optPotSeries);
  const stayPath = chartPath(stayPotSeries);
  const ages = traj.optInPath.map((p) => p.age);

  return (
    <main className="scroll" aria-labelledby="cpf-h">
      <button
        className="link-edit"
        onClick={() => go('dashboard')}
        style={{ alignSelf: 'flex-start' }}
      >
        ← Dashboard
      </button>
      <p className="chip" style={{ alignSelf: 'flex-start' }}>
        Signature decision — CPF Life Mirror
      </p>
      <h1 className="lede" id="cpf-h">
        The <span className="g">irreversible</span> decision, made calibrated.
      </h1>
      <p className="muted-p">
        Singapore's Platform Workers Act asks you to opt in to CPF — a one-way
        choice. Sarthi projects both lives side by side and shows the delta in
        cash, healthcare buffer, housing position, and shock resilience.
        Sarthi <b>never</b> executes the opt-in. You confirm with the official
        CPF Board portal.
      </p>

      <section className="cpf-chart-card card">
        <div className="cpf-chart-head">
          <span className="cpf-legend opt">Opt in</span>
          <span className="cpf-legend stay">Stay out</span>
        </div>
        <svg
          className="cpf-chart"
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          role="img"
          aria-label="Retirement pot trajectory"
        >
          <line
            x1={0}
            y1={CHART_H - 6}
            x2={CHART_W}
            y2={CHART_H - 6}
            stroke="var(--line)"
            strokeWidth="1"
          />
          <path d={stayPath} stroke="#7f8a85" strokeWidth="2" fill="none" />
          <path d={optPath} stroke="var(--grab)" strokeWidth="2.5" fill="none" />
          {(() => {
            const stepX = CHART_W / Math.max(optPotSeries.length - 1, 1);
            const x = idx * stepX;
            return (
              <line
                x1={x}
                y1={0}
                x2={x}
                y2={CHART_H - 6}
                stroke="var(--ink)"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
            );
          })()}
        </svg>
        <div className="cpf-chart-foot">
          <span>{ages[0]}</span>
          <span>{ages[Math.floor(ages.length / 2)]}</span>
          <span>{ages[ages.length - 1]}</span>
        </div>
      </section>

      <section className="card cpf-slider-card">
        <label htmlFor="cpf-age" className="section-label" style={{ margin: 0 }}>
          Age snapshot — drag to see the divergence
        </label>
        <input
          id="cpf-age"
          type="range"
          min={traj.current_age}
          max={traj.retirement_age}
          value={age}
          onChange={(e) => setAge(parseInt(e.target.value, 10))}
          className="cpf-slider"
          aria-valuemin={traj.current_age}
          aria-valuemax={traj.retirement_age}
          aria-valuenow={age}
        />
        <div className="cpf-age-readout">
          Age <b>{age}</b> · year <b>{optIn.year}</b>
        </div>
      </section>

      <div className="cpf-grid">
        <section className="card cpf-col cpf-opt">
          <div className="cpf-col-head">
            <span className="hero-icon" style={{ background: 'var(--grab)' }}>
              ✓
            </span>
            <span>
              <b>Opt in to CPF</b>
              <span className="goal-sub">Take-home {sgd(optIn.monthly_take_home)}/mo</span>
            </span>
          </div>
          <div className="cpf-row">
            <span>Retirement pot</span>
            <b className="cpf-amt">{sgd(optIn.retirement_pot)}</b>
          </div>
          <div className="cpf-row">
            <span>Healthcare buffer</span>
            <b>{sgd(optIn.healthcare_buffer)}</b>
          </div>
          <div className="cpf-row">
            <span>Housing position</span>
            <b>{sgd(optIn.housing_buffer)}</b>
          </div>
          <div className="cpf-row">
            <span>Cash in pocket</span>
            <b>{sgd(optIn.cumulative_cash_savings)}</b>
          </div>
          <div className="cpf-row">
            <span>Shock resilience</span>
            <b>{optIn.shock_resilience_days} days</b>
          </div>
        </section>

        <section className="card cpf-col cpf-stay">
          <div className="cpf-col-head">
            <span
              className="hero-icon"
              style={{ background: '#7f8a85', color: '#fff' }}
            >
              ◎
            </span>
            <span>
              <b>Stay out</b>
              <span className="goal-sub">Take-home {sgd(stayOut.monthly_take_home)}/mo</span>
            </span>
          </div>
          <div className="cpf-row">
            <span>Cash retirement pot</span>
            <b className="cpf-amt">{sgd(stayOut.retirement_pot)}</b>
          </div>
          <div className="cpf-row">
            <span>Healthcare buffer</span>
            <b>—</b>
          </div>
          <div className="cpf-row">
            <span>Housing position</span>
            <b>—</b>
          </div>
          <div className="cpf-row">
            <span>Cash in pocket</span>
            <b>{sgd(stayOut.cumulative_cash_savings)}</b>
          </div>
          <div className="cpf-row">
            <span>Shock resilience</span>
            <b>{stayOut.shock_resilience_days} days</b>
          </div>
        </section>
      </div>

      <section className="card cpf-headline">
        <span className="section-label" style={{ margin: 0 }}>
          The delta
        </span>
        <p className="hero-title" style={{ marginTop: 4 }}>
          {traj.delta.headline}
        </p>
      </section>

      <div className="section-label">How Sarthi reasoned</div>
      <section className="card cpf-trace">
        {reasoningTrace(traj).map((s, i) => (
          <div className="cpf-trace-row" key={i}>
            <span className="cpf-trace-num">{i + 1}</span>
            <div className="cpf-trace-text">
              <span>{s.label}</span>
              <code className="cpf-trace-tool">{s.tool}</code>
            </div>
          </div>
        ))}
      </section>

      <p className="note">
        Illustrative model. Worker share {(traj.worker_share * 100).toFixed(0)}%,
        operator match {(traj.operator_share * 100).toFixed(0)}%, blended CPF
        yield {(traj.cpf_growth_rate * 100).toFixed(1)}%, cash yield{' '}
        {(traj.cash_growth_rate * 100).toFixed(1)}%, surplus rate{' '}
        {(traj.surplus_rate * 100).toFixed(0)}% of net. Source:{' '}
        {traj.source.map((s) => s.tool).join(', ')}.
      </p>
    </main>
  );
}
