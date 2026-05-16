import { useMemo } from 'react';
import { useSarthi } from '../store/useSarthi';
import { verifyFigures } from '../agent/tools';
import WhyDisclosure from './WhyDisclosure';

export function TruthScoreBadge() {
  const { ds, driver, go, screen } = useSarthi();
  const report = useMemo(
    () => (ds && driver ? verifyFigures(ds, driver) : null),
    [ds, driver],
  );
  if (!ds || !driver || !report) return null;
  // Hide on the onboarding/discovery flow so it doesn't clash visually.
  if (screen === 'onboarding' || screen === 'discovery') return null;
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
  const report = useMemo(
    () => (ds && driver ? verifyFigures(ds, driver) : null),
    [ds, driver],
  );
  if (!ds || !driver || !report) return null;
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
        Truth check
      </p>
      <h1 className="lede" id="truth-h">
        Every number here is <span className="g">real</span>.
      </h1>
      <p className="muted-p">
        Nothing on your screens is made up. Each figure comes from your own
        data — {report.passed} of {report.total} checked and confirmed.
      </p>

      <section className={`card truth-headline ${ok ? 'good' : 'warn'}`}>
        <div className="truth-score">
          <span>{report.truth_score_pct}%</span>
          <small>
            {report.passed}/{report.total} numbers confirmed from your data
          </small>
        </div>
        <p className="goal-sub">{report.critic_summary}</p>
      </section>

      <WhyDisclosure label={`See all ${report.total} checks`}>
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
            </div>
            <p className="goal-sub">
              <b>From:</b> {c.source}
            </p>
            <p className={`goal-sub truth-reason ${c.ok ? 'pass' : 'fail'}`}>
              {c.reason}
            </p>
          </section>
        ))}
        <p className="note">
          Re-checked every time you open this screen. A number that can't be
          traced is refused, never shown.
        </p>
      </WhyDisclosure>
    </main>
  );
}
