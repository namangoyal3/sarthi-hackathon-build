import { useMemo } from 'react';
import { useSarthi } from '../store/useSarthi';
import { comparePaths, sgd } from '../agent/tools';
import type { ShockPath } from '../agent/tools';

const BUFFER_LABEL: Record<ShockPath['buffer_impact'], string> = {
  destroyed: 'Buffer destroyed',
  preserved: 'Buffer preserved',
  grows: 'Buffer grows',
};

const BUFFER_CLASS: Record<ShockPath['buffer_impact'], string> = {
  destroyed: 'shark-bad',
  preserved: 'shark-ok',
  grows: 'shark-good',
};

export default function SharkMoment() {
  const { ds, driver, lastShock, go } = useSarthi();
  const cmp = useMemo(
    () =>
      ds && driver && lastShock
        ? comparePaths(ds, driver, lastShock.amount, lastShock.category)
        : null,
    [ds, driver, lastShock],
  );
  if (!ds || !driver || !lastShock || !cmp) return null;

  const informal = cmp.paths.find((p) => p.id === 'informal')!;
  const recommended = cmp.paths.find((p) => p.recommended) ?? cmp.paths[0];

  return (
    <main className="scroll" aria-labelledby="shark-h">
      <p className="chip" style={{ alignSelf: 'flex-start' }}>
        Shock — Shark Moment
      </p>
      <h1 className="lede" id="shark-h">
        A <span className="g">{sgd(cmp.shock_amount)}</span> {cmp.shock_category} just hit.
      </h1>
      <p className="muted-p">
        Three paths are open right now. Sarthi compares them on total cost,
        buffer impact, and effort, with every figure traceable to a tool. Today,
        most drivers in Siti's situation reach for an off-app loan because it
        looks fastest. It is the most expensive way out.
      </p>

      {cmp.paths.map((p) => (
        <section
          key={p.id}
          className={`card shark-path ${p.recommended ? 'shark-rec' : ''}`}
          aria-current={p.recommended ? 'true' : undefined}
        >
          <div className="shark-head">
            <span className="shark-label">{p.label}</span>
            {p.recommended && <span className="shark-rec-tag">Recommended</span>}
          </div>
          <div className="shark-grid">
            <div>
              <div className="shark-k">Total cost</div>
              <div className="shark-v">
                {p.total_cost_sgd === 0
                  ? <span className="shark-good">{sgd(0)}</span>
                  : p.id === 'informal'
                    ? <span className="shark-bad">{sgd(p.total_cost_sgd)}</span>
                    : sgd(p.total_cost_sgd)}
              </div>
            </div>
            <div>
              <div className="shark-k">Buffer</div>
              <div className={`shark-v ${BUFFER_CLASS[p.buffer_impact]}`}>
                {BUFFER_LABEL[p.buffer_impact]}
              </div>
            </div>
            <div>
              <div className="shark-k">Time</div>
              <div className="shark-v">
                {p.id === 'earn'
                  ? `${p.effort_hours}h work · ${p.days_to_clear}d`
                  : `${p.days_to_clear} days`}
              </div>
            </div>
            <div>
              <div className="shark-k">APR</div>
              <div className="shark-v">
                {p.apr_pct > 0 ? `${p.apr_pct}%` : '0%'}
              </div>
            </div>
          </div>
          <p className="goal-sub">{p.why}</p>
          <details className="shark-evidence">
            <summary>Evidence</summary>
            <ul>
              {p.evidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        </section>
      ))}

      <section className="card shark-headline">
        <span className="section-label" style={{ margin: 0 }}>
          The delta
        </span>
        <p className="hero-title" style={{ marginTop: 4 }}>
          {cmp.delta_text}
        </p>
        <p className="goal-sub">
          The recommended path is <b>{recommended.label}</b>. The informal route
          costs an extra {sgd(informal.total_cost_sgd - recommended.total_cost_sgd)} and{' '}
          destroys the runway.
        </p>
      </section>

      <button
        className="btn go block"
        onClick={() => go('dashboard')}
        aria-label="Continue with the recommended path"
      >
        Continue with {recommended.label}
      </button>
      <button
        className="btn ghost block"
        onClick={() => go('dashboard')}
      >
        Back to dashboard
      </button>

      <p className="note">
        Sarthi never executes a draw, transfer, or extra shift. It prepares the
        decision; you confirm. Assumptions: {cmp.assumptions.join(' ')}
      </p>
    </main>
  );
}
