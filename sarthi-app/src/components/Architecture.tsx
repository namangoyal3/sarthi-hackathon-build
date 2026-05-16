import { useSarthi } from '../store/useSarthi';
import WhyDisclosure from './WhyDisclosure';

const AGENTS = [
  'Supervisor',
  'Expense Analyst',
  'Cashflow Forecaster',
  'Goal Tracker',
  'Action Planner',
  'CPF Strategist',
  'Conservative Earner',
  'Goal Chaser',
  'Fatigue & Safety Auditor',
  'Verification Critic',
  'Voice Intent Parser',
];

const TOOLS = [
  'income_summary',
  'expense_breakdown',
  'forecast_cashflow',
  'detect_anomaly',
  'predict_goals',
  'goal_tracker',
  'plan_actions',
  'match_product',
  'allocate_surplus',
  'check_unlocks',
  'cpf_project',
  'cpf_trajectory',
  'compare_paths',
  'committee_plan',
  'verify_figures',
  'country_shelf',
  'voice_intent',
  'time_machine_replay',
  'run_stress_test',
  'family_view',
  'scam_check',
];

export default function Architecture() {
  const { go } = useSarthi();
  return (
    <main className="scroll arch" aria-labelledby="ar-h">
      <button
        className="link-edit"
        onClick={() => go('dashboard')}
        style={{ alignSelf: 'flex-start' }}
      >
        ← Dashboard
      </button>
      <h1 className="lede" id="ar-h">
        Why you can <span className="g">trust</span> this
      </h1>
      <p className="muted-p">
        Sarthi never makes up a number and never moves your money. It works
        out the answer, shows its working, and waits for you to decide.
      </p>

      <section className="card">
        <div className="kv">
          <span>Decides with you</span>
          <b style={{ maxWidth: 210, textAlign: 'right', fontWeight: 600 }}>
            It prepares the decision. You confirm. It never opts you in,
            draws, or transfers.
          </b>
        </div>
        <div className="kv">
          <span>Never invents a number</span>
          <b style={{ maxWidth: 210, textAlign: 'right', fontWeight: 600 }}>
            Every figure traces to your own data — checked before it's shown.
          </b>
        </div>
        <div className="kv">
          <span>Stays in its lane</span>
          <b style={{ maxWidth: 210, textAlign: 'right', fontWeight: 600 }}>
            Refuses tax, legal and investment advice — points you to the
            right source.
          </b>
        </div>
        <div className="kv">
          <span>Nothing happens silently</span>
          <b style={{ maxWidth: 210, textAlign: 'right', fontWeight: 600 }}>
            Every re-plan is shown on screen with a trace you can open.
          </b>
        </div>
      </section>

      <WhyDisclosure label="How it's built, under the hood">
        <div className="layer brain">
          <div className="lyr-t">Brain — plans and phrases</div>
          <div className="pill-grid">
            {AGENTS.map((a) => (
              <span className="pill" key={a}>
                {a}
              </span>
            ))}
          </div>
          <p className="goal-sub" style={{ marginTop: 8 }}>
            Deterministic by default. An optional language layer only
            rephrases — it can never introduce a number.
          </p>
        </div>
        <div className="flowline">▼ calls typed tools ▼</div>
        <div className="layer tools">
          <div className="lyr-t">Tools — compute over your data</div>
          <div className="pill-grid">
            {TOOLS.map((t) => (
              <span className="pill mono" key={t}>
                {t}()
              </span>
            ))}
          </div>
          <p className="goal-sub" style={{ marginTop: 8 }}>
            Backed by 84k synthetic transactions plus the zone demand grid
            and shift log. Reconciled, never invented.
          </p>
        </div>
        <div className="flowline">▼ reads / writes ▼</div>
        <div className="layer memory">
          <div className="lyr-t">Memory — holds state</div>
          <div className="pill-grid">
            <span className="pill">Dashboard state</span>
            <span className="pill">Decision history</span>
            <span className="pill">Conversation history</span>
          </div>
          <p className="goal-sub" style={{ marginTop: 8 }}>
            Exact typed tables, not a vector store — your financial data is
            bounded and precise.
          </p>
        </div>
      </WhyDisclosure>
    </main>
  );
}
