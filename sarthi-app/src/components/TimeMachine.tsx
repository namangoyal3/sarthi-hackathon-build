import { useMemo } from 'react';
import { useSarthi } from '../store/useSarthi';
import { timeMachineReplay, sgd, sgd1 } from '../agent/tools';
import WhyDisclosure from './WhyDisclosure';

export default function TimeMachine() {
  const { ds, driver, go } = useSarthi();
  const replay = useMemo(
    () => (ds && driver ? timeMachineReplay(ds, driver) : null),
    [ds, driver],
  );
  if (!ds || !driver || !replay) return null;

  return (
    <main className="scroll" aria-labelledby="tm-h">
      <button
        className="link-edit"
        onClick={() => go('dashboard')}
        style={{ alignSelf: 'flex-start' }}
      >
        ← Dashboard
      </button>
      <p className="chip" style={{ alignSelf: 'flex-start' }}>
        Time Machine — counterfactual replay
      </p>
      <h1 className="lede" id="tm-h">
        Last week, <span className="g">alternatively</span>.
      </h1>
      <p className="muted-p">
        Your last 7 shifts vs the best windows on those same days. Not blame —
        just what an extra hour here or there was worth.
      </p>

      <section className="card tm-headline">
        <span className="section-label" style={{ margin: 0 }}>
          The delta
        </span>
        <p className="hero-title" style={{ marginTop: 4 }}>
          {replay.delta.headline}
        </p>
        <div className="tm-delta-row">
          <div>
            <small>You earned</small>
            <b>{sgd(replay.reality.total_earned_sgd)}</b>
          </div>
          <div>
            <small>Could have earned</small>
            <b className="tm-alt">{sgd(replay.alternate.total_earned_sgd)}</b>
          </div>
          <div>
            <small>Net diff</small>
            <b
              className={
                replay.delta.earnings_uplift_sgd >= 0 ? 'tm-up' : 'tm-down'
              }
            >
              {replay.delta.earnings_uplift_sgd >= 0 ? '+' : ''}
              {sgd(replay.delta.earnings_uplift_sgd)}
            </b>
          </div>
        </div>
      </section>

      <div className="section-label">Reality (last 7 shifts)</div>
      <section className="card tm-list">
        {replay.reality.shifts.map((s, i) => (
          <div key={i} className="tm-row">
            <span>{s.date}</span>
            <span className="tm-zone">{s.zone}</span>
            <span>{s.hours.toFixed(1)}h</span>
            <b>{sgd(s.earned_sgd)}</b>
          </div>
        ))}
        <div className="tm-row tm-total">
          <span></span>
          <span></span>
          <span>{replay.reality.total_hours}h</span>
          <b>{sgd(replay.reality.total_earned_sgd)}</b>
        </div>
      </section>

      <div className="section-label">Alternate plan (top windows)</div>
      <section className="card tm-list tm-alt-list">
        {replay.alternate.shifts.map((s, i) => (
          <div key={i} className="tm-row">
            <span>{s.day_of_week}</span>
            <span className="tm-zone">{s.zone_label}</span>
            <span>
              {String(s.hour).padStart(2, '0')}:00 · {s.hours}h
            </span>
            <b>{sgd(s.expected_net_sgd)}</b>
          </div>
        ))}
        <div className="tm-row tm-total">
          <span></span>
          <span></span>
          <span>{replay.alternate.total_hours}h</span>
          <b>{sgd(replay.alternate.total_earned_sgd)}</b>
        </div>
      </section>

      <div className="section-label">Two named decisions</div>
      <section className="card tm-named">
        <p>
          <b>Biggest miss</b> · {replay.delta.biggest_miss.date} ·{' '}
          {replay.delta.biggest_miss.zone}
          <br />
          <span className="goal-sub">
            Alternate plan was {sgd(replay.delta.biggest_miss.gain_sgd)} ahead on
            this day.
          </span>
        </p>
        <p>
          <b>Biggest keep</b> · {replay.delta.biggest_keep.date} ·{' '}
          {replay.delta.biggest_keep.zone}
          <br />
          <span className="goal-sub">
            Your real shift was {sgd(replay.delta.biggest_keep.gain_sgd)} above
            the alternate. Sarthi would not have changed this.
          </span>
        </p>
      </section>

      <p className="note">
        Your hour: {sgd1(replay.reality.avg_net_per_hour)} · best windows:{' '}
        {sgd1(replay.alternate.avg_net_per_hour)}
      </p>

      <WhyDisclosure label="Where these numbers come from">
        <p className="note">{replay.evidence.join(' · ')}</p>
      </WhyDisclosure>
    </main>
  );
}
