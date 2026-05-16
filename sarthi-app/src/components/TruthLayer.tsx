import { useMemo } from 'react';
import { useSarthi } from '../store/useSarthi';
import { verifyFigures } from '../agent/tools';

export function TruthScoreBadge() {
  const { ds, driver, go, screen } = useSarthi();
  if (!ds || !driver) return null;
  // Hide on the onboarding/discovery flow so it doesn't clash visually.
  if (screen === 'onboarding' || screen === 'discovery') return null;
  const report = useMemo(() => verifyFigures(ds, driver), [ds, driver]);
  const ok = report.truth_score_pct >= 90;
  return (
    <button
      className={`truth-badge ${ok ? 'good' : 'warn'}`}
      onClick={() => go('truth')}
      aria-label={`Truth Score ${report.truth_score_pct}%`}
    >
      <span aria-hidden>{ok ? '✓' : '!'}</span>
      Truth {report.truth_score_pct}%
    </button>
  );
}

export default function TruthLayer() {
  const { ds, driver, go } = useSarthi();
  if (!ds || !driver) return null;
  const report = useMemo(() => verifyFigures(ds, driver), [ds, driver]);
  const ok = report.truth_score_pct >= 90;

  return (
    <main className="scroll" aria-labelledby="truth-h">
      <button
        className="link-edit"
        onClick={() => go('dashboard')}
        style={{ alignSelf: 'flex-start' }}
      >
        ← Dashboard
      </button>
      <p className="chip" style={{ alignSelf: 'flex-start' }}>
        Verification Streamer — adversarial critic
      </p>
      <h1 className="lede" id="truth-h">
        Every number, <span className="g">provable</span>.
      </h1>
      <p className="muted-p">
        A critic agent walks every figure Sarthi could surface for{' '}
        {driver.name.split(' ')[0]} and tries to refute it. The Truth Score is
        the share that survives. Anything that doesn't trace cleanly is{' '}
        <b>refused</b>, not softened.
      </p>

      <section className={`card truth-headline ${ok ? 'good' : 'warn'}`}>
        <div className="truth-score">
          <span>{report.truth_score_pct}%</span>
          <small>Truth Score · {report.passed}/{report.total} claims grounded</small>
        </div>
        <p className="goal-sub">{report.critic_summary}</p>
      </section>

      <div className="section-label">Claims under review</div>
      {report.claims.map((c) => (
        <section
          key={c.id}
          className={`card truth-claim ${c.ok ? 'pass' : 'fail'}`}
        >
          <div className="truth-claim-head">
            <span className="truth-mark" aria-hidden>
              {c.ok ? '✓' : '✕'}
            </span>
            <span>
              <b>{c.label}</b>
              <span className="goal-sub">{c.value}</span>
            </span>
            <code className="truth-tool">{c.tool}</code>
          </div>
          <p className="goal-sub">
            <b>Source:</b> {c.source}
          </p>
          <p className="goal-sub">
            <b>Evidence:</b> {c.evidence}
          </p>
          <p className={`goal-sub truth-reason ${c.ok ? 'pass' : 'fail'}`}>
            {c.reason}
          </p>
        </section>
      ))}

      <p className="note">
        Generated at {report.generated_at}. The Truth Score is recomputed
        on every screen open. The critic never softens a refusal — it shows you
        what was rejected and why.
      </p>
    </main>
  );
}
