import { useState } from 'react';
import { useSarthi } from '../store/useSarthi';
import {
  countryShelf,
  listCountries,
  compareShelves,
} from '../agent/tools';
import type { CountryCode } from '../agent/tools';

const ORDER: CountryCode[] = ['SG', 'ID', 'MY', 'PH'];

export default function MultiCountry() {
  const { go } = useSarthi();
  const [code, setCode] = useState<CountryCode>('SG');
  const shelf = countryShelf(code);
  const grid = compareShelves();

  return (
    <main className="scroll" aria-labelledby="country-h">
      <button
        className="link-edit"
        onClick={() => go('dashboard')}
        style={{ alignSelf: 'flex-start' }}
      >
        ← Dashboard
      </button>
      <p className="chip" style={{ alignSelf: 'flex-start' }}>
        Multi-Country — same agent, different jurisdiction
      </p>
      <h1 className="lede" id="country-h">
        One agent. <span className="g">Every Grab country</span>.
      </h1>
      <p className="muted-p">
        Same Sarthi, every Grab country. Tap a flag — the products, pension
        scheme and protections switch to that country's real shelf.
      </p>

      <div className="country-tabs" role="tablist" aria-label="Country">
        {listCountries().map((s) => (
          <button
            key={s.code}
            role="tab"
            aria-selected={code === s.code}
            className={`country-tab ${code === s.code ? 'on' : ''}`}
            onClick={() => setCode(s.code)}
          >
            <span className="country-flag" aria-hidden>
              {s.flag}
            </span>
            <span>{s.code}</span>
          </button>
        ))}
      </div>

      <section className="card country-card">
        <div className="country-head">
          <span className="country-flag-lg" aria-hidden>
            {shelf.flag}
          </span>
          <span>
            <b>{shelf.name}</b>
            <span className="goal-sub">
              Currency {shelf.currency} · median gig income {shelf.median_gig_income}
            </span>
          </span>
        </div>
        <div className="country-row">
          <span>Bank / wallet</span>
          <b>{shelf.bank}</b>
        </div>
        <div className="country-row">
          <span>Saving pocket</span>
          <b>{shelf.saving_pocket}</b>
        </div>
        <div className="country-row">
          <span>Bridge credit</span>
          <b>{shelf.bridge_credit}</b>
        </div>
        <div className="country-row">
          <span>Invest entry</span>
          <b>{shelf.invest}</b>
        </div>
        <div className="country-row">
          <span>Pension scheme</span>
          <b>
            {shelf.pension_scheme}
            {shelf.pension_one_way && (
              <span className="country-warn"> · one-way</span>
            )}
          </b>
        </div>
        <div className="country-row">
          <span>Partner protection</span>
          <b>{shelf.partner_protection}</b>
        </div>
        <p className="goal-sub" style={{ marginTop: 8 }}>
          {shelf.notes}
        </p>
      </section>

      <div className="section-label">Side-by-side</div>
      <section className="card country-grid-card">
        <table className="country-table">
          <thead>
            <tr>
              <th></th>
              {ORDER.map((c) => (
                <th key={c} className={c === code ? 'active' : ''}>
                  {countryShelf(c).flag} {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.row}>
                <td>{row.row}</td>
                {ORDER.map((c) => (
                  <td key={c} className={c === code ? 'active' : ''}>
                    {(row as Record<string, string>)[c]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="note">
        Country shelves are illustrative. Sarthi shows the shelf — it does not
        give cross-border advice.
      </p>
    </main>
  );
}
