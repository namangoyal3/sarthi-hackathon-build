import { useEffect, useMemo, useState } from 'react';
import { useSarthi } from '../store/useSarthi';
import { committeePlan, sgd } from '../agent/tools';
import type { CommitteeAgentId, CommitteeRound } from '../agent/tools';

const AGENT_META: Record<
  CommitteeAgentId,
  { ic: string; tone: string }
> = {
  conservative: { ic: '◇', tone: 'committee-cons' },
  chaser: { ic: '★', tone: 'committee-chaser' },
  safety: { ic: '◐', tone: 'committee-safety' },
};

function speak(round: CommitteeRound) {
  return (
    <div
      className={`committee-bubble ${AGENT_META[round.agent].tone}`}
      key={`${round.round}-${round.agent}-${round.text.slice(0, 12)}`}
    >
      <div className="committee-speaker">
        <span aria-hidden>{AGENT_META[round.agent].ic}</span>
        <b>{round.speaker}</b>
        <span className="committee-round">round {round.round}</span>
      </div>
      <p>{round.text}</p>
    </div>
  );
}

export default function VisibleCommittee() {
  const { ds, driver, go } = useSarthi();
  const plan = useMemo(
    () => (ds && driver ? committeePlan(ds, driver) : null),
    [ds, driver],
  );
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    if (!plan || revealed >= plan.debate.length) return;
    const t = window.setTimeout(() => setRevealed((r) => r + 1), 850);
    return () => window.clearTimeout(t);
  }, [revealed, plan]);

  if (!ds || !driver || !plan) return null;

  const debateShown = plan.debate.slice(0, revealed);
  const debateDone = revealed >= plan.debate.length;

  return (
    <main className="scroll" aria-labelledby="committee-h">
      <button
        className="link-edit"
        onClick={() => go('dashboard')}
        style={{ alignSelf: 'flex-start' }}
      >
        ← Dashboard
      </button>
      <p className="chip" style={{ alignSelf: 'flex-start' }}>
        Visible Committee — three voices, one plan
      </p>
      <h1 className="lede" id="committee-h">
        Three agents, <span className="g">one council</span>.
      </h1>
      <p className="muted-p">
        Three planners argue it out: one protects your buffer, one pushes the
        goal, one guards your rest. You see them disagree, then agree.
      </p>

      <div className="section-label">Proposals</div>
      <div className="committee-grid">
        {plan.proposals.map((p) => (
          <section
            className={`card committee-card ${AGENT_META[p.agent].tone}`}
            key={p.agent}
            aria-label={p.agent_label}
          >
            <div className="committee-head">
              <span className="committee-ic">{AGENT_META[p.agent].ic}</span>
              <span>
                <b>{p.agent_label}</b>
                <span className="goal-sub">{p.agent_role}</span>
              </span>
            </div>
            <div className="committee-row">
              <span>Hours next 7d</span>
              <b>{p.hours_next_7d}h</b>
            </div>
            <div className="committee-row">
              <span>Est. earnings</span>
              <b>{sgd(p.est_earnings_sgd)}</b>
            </div>
            <div className="committee-row">
              <span>Zones</span>
              <b style={{ textAlign: 'right', maxWidth: 180 }}>
                {p.zones.slice(0, 2).join(' · ') || 'top demand'}
              </b>
            </div>
            <p className="goal-sub">{p.argument}</p>
            <details className="committee-concerns">
              <summary>What this risks</summary>
              <ul>
                {p.concerns.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
          </section>
        ))}
      </div>

      <div className="section-label">The debate (live)</div>
      <section className="card committee-debate" aria-live="polite">
        {debateShown.map((r) => speak(r))}
        {!debateDone && (
          <div className="committee-typing" aria-label="Next agent thinking">
            <span></span>
            <span></span>
            <span></span>
          </div>
        )}
        {debateDone && (
          <button
            className="btn ghost"
            onClick={() => setRevealed(0)}
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
          >
            ↻ Replay debate
          </button>
        )}
      </section>

      <div className="section-label">Consensus</div>
      <section className="card committee-consensus">
        <div className="committee-head">
          <span className="committee-ic">✓</span>
          <span>
            <b>Plan for the next 7 days</b>
            <span className="goal-sub">{plan.consensus.summary}</span>
          </span>
        </div>
        <div className="committee-row">
          <span>Hours</span>
          <b>{plan.consensus.hours_next_7d}h</b>
        </div>
        <div className="committee-row">
          <span>Earnings target</span>
          <b>{sgd(plan.consensus.est_earnings_sgd)}</b>
        </div>
        <div className="committee-row">
          <span>Zones</span>
          <b style={{ textAlign: 'right', maxWidth: 200 }}>
            {plan.consensus.zones.slice(0, 3).join(' · ')}
          </b>
        </div>
        <ul className="committee-rejected">
          {plan.consensus.rejected.map((r) => (
            <li key={r.agent}>
              <b>{r.agent}:</b> {r.reason}
            </li>
          ))}
        </ul>
      </section>

      <button
        className="btn go block"
        onClick={() => go('dashboard')}
      >
        Accept this plan
      </button>
      <button className="btn ghost block" onClick={() => go('dashboard')}>
        I want to push more hours
      </button>
      <button className="btn ghost block" onClick={() => go('dashboard')}>
        I want fewer hours
      </button>

      <p className="note">
        The committee reasons over the same data the rest of Sarthi uses.
        Evidence: {plan.evidence.join(' · ')}.
      </p>
    </main>
  );
}
