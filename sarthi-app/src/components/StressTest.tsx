import { useMemo, useState } from 'react';
import { useSarthi } from '../store/useSarthi';
import { runStressTest, sgd, STRESS_SHOCKS } from '../agent/tools';

const DEFAULT_ON = ['medical', 'fuel', 'vehicle'];

export default function StressTest() {
  const { ds, driver, go } = useSarthi();
  if (!ds || !driver) return null;
  const [enabled, setEnabled] = useState<string[]>(DEFAULT_ON);
  const result = useMemo(
    () => runStressTest(ds, driver, enabled),
    [ds, driver, enabled],
  );
  const safe = result.resilience_score_pct >= 70;
  const max = Math.max(...result.histogram, 1);

  function toggle(id: string) {
    setEnabled((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <main className="scroll" aria-labelledby="stress-h">
      <button
        className="link-edit"
        onClick={() => go('dashboard')}
        style={{ alignSelf: 'flex-start' }}
      >
        ← Dashboard
      </button>
      <p className="chip" style={{ alignSelf: 'flex-start' }}>
        Stress-Test Studio — Monte Carlo
      </p>
      <h1 className="lede" id="stress-h">
        How <span className="g">resilient</span> is this week?
      </h1>
      <p className="muted-p">
        Sarthi simulates the next {result.weeks} weeks {result.iterations} times,
        applying the shocks you select. The Resilience Score is the share of
        simulations that stay above the safety line.
      </p>

      <div className="section-label">Pick the shocks to test</div>
      <section className="card stress-shocks">
        {STRESS_SHOCKS.map((s) => {
          const on = enabled.includes(s.id);
          return (
            <label key={s.id} className={`stress-shock ${on ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(s.id)}
              />
              <span>
                <b>{s.label}</b>
                <span className="goal-sub">
                  ~{Math.round(s.weekly_probability * 100 * 4.33)}% in any month ·{' '}
                  {sgd(s.amount_low)}–{sgd(s.amount_high)}
                </span>
              </span>
            </label>
          );
        })}
      </section>

      <section className={`card stress-headline ${safe ? 'good' : 'warn'}`}>
        <div className="stress-score">
          <span>{result.resilience_score_pct}%</span>
          <small>
            Resilience over {result.weeks} weeks · {result.iterations} simulations
          </small>
        </div>
        <p className="goal-sub">
          {safe
            ? `Looks resilient. Expected shortfall when things go wrong: ${sgd(result.expected_shortfall_sgd)}.`
            : `Cracks visible. Expected shortfall in failed runs: ${sgd(result.expected_shortfall_sgd)}. Sarthi recommends a tighter buffer goal.`}
        </p>
      </section>

      <div className="section-label">Final cash distribution</div>
      <section className="card stress-hist">
        {result.histogram.map((n, i) => {
          const h = Math.max(4, Math.round((n / max) * 100));
          return (
            <div
              key={i}
              className="stress-bar"
              style={{ height: `${h}%` }}
              aria-label={`bucket ${i}: ${n} runs`}
            />
          );
        })}
      </section>

      <div className="section-label">Weakest links</div>
      <section className="card stress-links">
        {result.weakest_links.length === 0 ? (
          <p className="goal-sub">No failures observed in this run.</p>
        ) : (
          result.weakest_links.map((w, i) => (
            <div className="stress-link-row" key={i}>
              <span className="stress-link-rank">{i + 1}</span>
              <div>
                <b>{w.reason}</b>
                <span className="goal-sub">
                  Most common failure week: week {w.week} · failed {w.freq}{' '}
                  simulation{w.freq === 1 ? '' : 's'}.
                </span>
              </div>
            </div>
          ))
        )}
      </section>

      <p className="note">
        {result.evidence.join(' · ')}
      </p>
    </main>
  );
}
