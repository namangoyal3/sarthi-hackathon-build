import { useMemo, useState } from 'react';
import { useSarthi } from '../store/useSarthi';
import { scamCheck } from '../agent/tools';
import WhyDisclosure from './WhyDisclosure';

const SAMPLES = [
  'APPROVED! S$500 cash today. No NRIC needed. Daily interest 0.8%. WhatsApp me to claim before 8pm.',
  'Hi, GXS FlexiLoan first draw approved. Open the Grab app to confirm.',
  'Send me your OTP, I will help process the loan immediately. No documents needed.',
];

export default function ScamShield() {
  const { go } = useSarthi();
  const [text, setText] = useState(SAMPLES[0]);
  const report = useMemo(() => scamCheck(text), [text]);
  const tone =
    report.level === 'predatory'
      ? 'red'
      : report.level === 'suspicious'
        ? 'amber'
        : 'green';

  return (
    <main className="scroll" aria-labelledby="scam-h">
      <button
        className="link-edit"
        onClick={() => go('dashboard')}
        style={{ alignSelf: 'flex-start' }}
      >
        ← Dashboard
      </button>
      <p className="chip" style={{ alignSelf: 'flex-start' }}>
        Scam Shield — pattern + APR check
      </p>
      <h1 className="lede" id="scam-h">
        The driver's <span className="g">advocate</span>.
      </h1>
      <p className="muted-p">
        Paste a "fast cash" offer or a loan you're not sure about. Sarthi
        checks it on your phone — nothing leaves the device — and shows what
        it would really cost you.
      </p>

      <section className="card scam-input">
        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a suspicious message…"
        />
        <div className="scam-samples">
          {SAMPLES.map((s, i) => (
            <button
              key={i}
              className="voice-prompt"
              onClick={() => setText(s)}
            >
              Sample {i + 1}
            </button>
          ))}
        </div>
      </section>

      <section className={`card scam-headline scam-${tone}`}>
        <span className="section-label" style={{ margin: 0 }}>
          Verdict
        </span>
        <p className="hero-title" style={{ marginTop: 4 }}>
          {report.counter.headline}
        </p>
        <p className="goal-sub">{report.counter.detail}</p>
        <div className="scam-meta">
          <div>
            <small>Estimated APR</small>
            <b>
              {report.estimated_apr_pct === null
                ? 'n/a'
                : `${Math.round(report.estimated_apr_pct)}%`}
            </b>
          </div>
          <div>
            <small>30-day cost</small>
            <b>
              {report.estimated_30d_cost_sgd === null
                ? 'n/a'
                : `S$${report.estimated_30d_cost_sgd.toLocaleString('en-SG')}`}
            </b>
          </div>
          <div>
            <small>Signals</small>
            <b>{report.reasons.length}</b>
          </div>
        </div>
      </section>

      {report.reasons.length > 0 && (
        <>
          <div className="section-label">Why Sarthi flagged this</div>
          <section className="card scam-reasons">
            <ul>
              {report.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
        </>
      )}

      <button
        className="btn go block"
        onClick={() => go('dashboard')}
      >
        {report.counter.cta}
      </button>

      <WhyDisclosure label="How Sarthi checked this">
        <p className="note">{report.evidence.join(' · ')}</p>
      </WhyDisclosure>
    </main>
  );
}
