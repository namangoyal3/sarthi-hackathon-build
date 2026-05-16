import { useMemo, useState } from 'react';
import { useSarthi } from '../store/useSarthi';
import { FAMILY_MEMBERS, familyView } from '../agent/tools';
import type { FamilyRole } from '../agent/tools';

export default function FamilyVault() {
  const { ds, driver, go } = useSarthi();
  if (!ds || !driver) return null;
  const [role, setRole] = useState<FamilyRole>('driver');
  const view = useMemo(() => familyView(ds, driver, role), [ds, driver, role]);

  return (
    <main className="scroll" aria-labelledby="family-h">
      <button
        className="link-edit"
        onClick={() => go('dashboard')}
        style={{ alignSelf: 'flex-start' }}
      >
        ← Dashboard
      </button>
      <p className="chip" style={{ alignSelf: 'flex-start' }}>
        Family Vault — multi-stakeholder
      </p>
      <h1 className="lede" id="family-h">
        Money decisions, <span className="g">made together</span>.
      </h1>
      <p className="muted-p">
        Sarthi holds one household state and projects different views per
        role. The driver sees earnings; the spouse sees readiness; a child
        sees safety. Sensitive data is filtered per role — never deleted from
        the underlying state, never leaked.
      </p>

      <div className="family-tabs" role="tablist" aria-label="Role">
        {FAMILY_MEMBERS.map((m) => (
          <button
            key={m.role}
            role="tab"
            aria-selected={role === m.role}
            className={`family-tab ${role === m.role ? 'on' : ''}`}
            onClick={() => setRole(m.role)}
          >
            <span aria-hidden>{m.badge}</span>
            <span>
              <b>{m.display_name}</b>
              <small>{m.relation}</small>
            </span>
          </button>
        ))}
      </div>

      <section className="card family-tiles">
        {view.tiles.map((t) => (
          <div className="family-tile" key={t.title}>
            <span className="family-tile-k">{t.title}</span>
            <b className="family-tile-v">{t.value}</b>
            <span className="goal-sub">{t.detail}</span>
            <code className="family-tile-tool">{t.source}</code>
          </div>
        ))}
      </section>

      <div className="section-label">Shared goals</div>
      <section className="card">
        {view.shared_goals.map((g) => (
          <div className="family-goal" key={g.name}>
            <div className="family-goal-row">
              <span>{g.name}</span>
              <b>{g.progress_pct}%</b>
            </div>
            <div className="progress">
              <i style={{ width: `${g.progress_pct}%` }} />
            </div>
          </div>
        ))}
      </section>

      {view.hidden_from_role.length > 0 && (
        <>
          <div className="section-label">Hidden from this role</div>
          <section className="card family-hidden">
            <ul>
              {view.hidden_from_role.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
            <p className="goal-sub">
              The data still exists in Sarthi's state — it is filtered, not
              deleted. The driver remains in control of who sees what.
            </p>
          </section>
        </>
      )}

      <p className="note">{view.evidence.join(' · ')}</p>
    </main>
  );
}
