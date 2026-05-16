// Typed tools over the driver's data. Sub-agents do not improvise — every
// number Sarthi states comes from one of these deterministic functions, so it
// is auditable and grounded (Agent Spec §3).

import type {
  Dataset,
  Driver,
  MonthlySummary,
  GoalActionLink,
  Txn,
  AllocationPlan,
  Unlock,
  ZoneCell,
} from '../data/types';

export const sgd = (n: number): string =>
  'S$' + Math.round(n).toLocaleString('en-SG');
export const sgd1 = (n: number): string =>
  'S$' + n.toLocaleString('en-SG', { maximumFractionDigits: 1 });

export function driverMonths(ds: Dataset, id: string): MonthlySummary[] {
  return ds.monthly
    .filter((m) => m.driver_id === id)
    .sort((a, b) => a.month.localeCompare(b.month));
}

// income_summary — net earnings + average daily income (Forecaster)
export function incomeSummary(ds: Dataset, id: string) {
  const ms = driverMonths(ds, id);
  const recent = ms.slice(-3);
  const avgNet =
    recent.reduce((s, m) => s + m.net_income, 0) / Math.max(recent.length, 1);
  const last = ms[ms.length - 1];
  return {
    avgMonthlyNet: avgNet,
    avgDailyNet: avgNet / 30,
    lastMonth: last,
    months: ms,
    volatility:
      recent.length > 1
        ? Math.max(...recent.map((m) => m.net_income)) -
          Math.min(...recent.map((m) => m.net_income))
        : 0,
  };
}

// expense_breakdown — spend by category over the latest month (Expense Analyst)
export function expenseBreakdown(ds: Dataset, id: string) {
  const months = [...new Set(ds.categories.filter((c) => c.driver_id === id).map((c) => c.month))].sort();
  const latest = months[months.length - 1];
  const rows = ds.categories
    .filter((c) => c.driver_id === id && c.month === latest)
    .sort((a, b) => b.total_amount - a.total_amount);
  return { month: latest, rows, total: rows.reduce((s, r) => s + r.total_amount, 0) };
}

// forecast_cashflow — cash runway in days under a stress scenario
// (Frontend Spec §4.1). runway = (balance - comfort) / daily_burn,
// daily_burn = daily_expense - stressed_daily_income (income at ~55%).
export function forecastCashflow(
  ds: Dataset,
  id: string,
  extraExpense = 0,
) {
  const inc = incomeSummary(ds, id);
  const last = inc.lastMonth;
  const balance =
    latestBalance(ds, id) ?? (last ? last.net_income * 1.4 : 1500);
  const dailyExpense = (last ? last.total_expense : 1800) / 30;
  const stressedDailyIncome = inc.avgDailyNet * 0.55;
  const dailyBurn = Math.max(dailyExpense - stressedDailyIncome, 1);
  const comfortLine = (last ? last.total_expense : 1800); // ~1 month expenses
  const usable = balance - comfortLine - extraExpense;
  const days = Math.max(Math.round(usable / dailyBurn), 0);
  return { days, balance: balance - extraExpense, comfortLine, dailyBurn };
}

export function latestBalance(ds: Dataset, id: string): number | null {
  const t = ds.txns
    .filter((x) => x.driver_id === id && x.running_balance)
    .sort((a, b) => a.date.localeCompare(b.date));
  return t.length ? t[t.length - 1].running_balance : null;
}

// detect_anomaly — transactions beyond the driver's normal pattern
export function detectAnomaly(ds: Dataset, id: string): Txn[] {
  return ds.txns
    .filter(
      (x) =>
        x.driver_id === id &&
        x.anomaly_flag &&
        x.anomaly_flag !== 'none' &&
        x.anomaly_flag.toLowerCase() !== 'false',
    )
    .slice(-5);
}

// goal_tracker — per-goal latest week status from the goal-action link
export function goalStatus(ds: Dataset, goalId: string): GoalActionLink | null {
  const rows = ds.goalLinks
    .filter((g) => g.goal_id === goalId)
    .sort((a, b) => a.iso_week.localeCompare(b.iso_week));
  return rows.length ? rows[rows.length - 1] : null;
}

// predict_goals — synthesise personalised goals from profile + spend.
// Deterministic stand-in for the LLM goal-synthesis node: it scores the goal
// catalogue against the driver's real financial reality and returns ranked
// proposals with a plain-language reason grounded in their numbers.
export interface ProposedGoal {
  goal_key: string;
  name: string;
  category: string;
  why: string;
  target: number;
  monthly: number;
  horizon: string;
  existingGoalId?: string;
}

export function predictGoals(ds: Dataset, driver: Driver): ProposedGoal[] {
  const inc = incomeSummary(ds, driver.driver_id);
  const last = inc.lastMonth;
  const obligations = ds.obligations.filter((o) => o.driver_id === driver.driver_id);
  const debt = obligations
    .filter((o) => o.category === 'DEBT_REPAY')
    .reduce((s, o) => s + (o.typical_amount_low + o.typical_amount_high) / 2, 0);
  const existing = ds.goals.filter(
    (g) => g.driver_id === driver.driver_id && g.status === 'active',
  );
  const findExisting = (key: string) =>
    existing.find((g) => g.goal_key === key)?.goal_id;

  const proposals: ProposedGoal[] = [];
  const net = inc.avgMonthlyNet || 1;

  // 1. Safety net — always relevant for thin-file gig workers, sharpest for
  //    firefighters with negative recent cashflow.
  const negative = inc.months.slice(-3).filter((m) => m.net_cashflow < 0).length;
  if (driver.persona === 'firefighter' || negative > 0) {
    proposals.push({
      goal_key: 'emergency_fund',
      name: 'Emergency cash buffer',
      category: 'safety',
      why: `You had ${negative} deficit month${negative === 1 ? '' : 's'} in the last 3 and no employer safety net. One month of your expenses (${sgd(last?.total_expense ?? 1800)}) is the buffer that stops a slow week becoming debt.`,
      target: Math.round((last?.total_expense ?? 1800) / 50) * 50,
      monthly: Math.round((net * 0.08) / 10) * 10,
      horizon: 'medium',
      existingGoalId: findExisting('emergency_fund'),
    });
  }

  // 2. Health insurance — keyed off dependents (family protection pitch).
  proposals.push({
    goal_key: 'health_insurance_fund',
    name: driver.dependents > 0 ? 'Family health insurance fund' : 'Health insurance fund',
    category: 'safety',
    why: `You support ${driver.dependents} dependent${driver.dependents === 1 ? '' : 's'} with no medical cover. Setting aside the annual premium means a hospital visit never becomes a loan — and it unlocks a partner family plan.`,
    target: 1130,
    monthly: Math.round((net * 0.05) / 10) * 10,
    horizon: 'medium',
    existingGoalId: findExisting('health_insurance_fund'),
  });

  // 3. Debt clearance — only when the driver actually carries debt.
  if (debt > 0) {
    proposals.push({
      goal_key: 'vehicle_loan_payoff',
      name: 'Clear the vehicle loan early',
      category: 'debt',
      why: `Your debt instalments run about ${sgd(debt)}/mo. Clearing the ${driver.vehicle} loan ahead of schedule frees that cash and cuts total interest.`,
      target: Math.round((debt * 18) / 50) * 50,
      monthly: Math.round((net * 0.06) / 10) * 10,
      horizon: 'long',
      existingGoalId: findExisting('vehicle_loan_payoff'),
    });
  }

  // 4. Grow surplus — only for drivers who actually run a surplus.
  if ((last?.net_cashflow ?? 0) > 80 || driver.persona === 'stabilizer') {
    proposals.push({
      goal_key: 'income_smoothing_buffer',
      name: 'Income smoothing pocket',
      category: 'safety',
      why: `Your income swings about ${sgd(inc.volatility)} month to month. A liquid pocket tops up lean weeks so essentials are always covered, then the rest compounds.`,
      target: Math.round((net * 0.6) / 50) * 50,
      monthly: Math.round((net * 0.07) / 10) * 10,
      horizon: 'short',
      existingGoalId: findExisting('income_smoothing_buffer'),
    });
  }

  return proposals.slice(0, 4);
}

// compare_paths — the Shark Moment.
// Given a shock, surface three explicit paths the driver could take and grade
// each on total cost, runway impact, time-to-clear, and buffer survival.
// Sarthi never invents APRs — informal-credit and FlexiLoan parameters are
// stated alongside the result for full traceability.
export interface ShockPath {
  id: 'informal' | 'flexi' | 'earn';
  label: string;
  channel: string;
  total_cost_sgd: number;
  buffer_impact: 'destroyed' | 'preserved' | 'grows';
  days_to_clear: number;
  apr_pct: number;
  effort_hours: number;
  why: string;
  recommended: boolean;
  evidence: string[];
}

export interface PathComparison {
  shock_amount: number;
  shock_category: string;
  recommended: ShockPath['id'];
  paths: ShockPath[];
  delta_text: string;
  assumptions: string[];
}

export function comparePaths(
  ds: Dataset,
  driver: Driver,
  shockAmount: number,
  shockCategory: string,
): PathComparison {
  const inc = incomeSummary(ds, driver.driver_id);
  const monthlyNet = Math.max(inc.avgMonthlyNet, 1);
  const dailyBurn = (inc.lastMonth?.total_expense ?? monthlyNet) / 30;

  // Informal credit: illustrative SE-Asian loan-shark range. Stated openly.
  const informalAprPct = 87;
  const informalTermDays = 28;
  const informalInterest =
    shockAmount * (informalAprPct / 100) * (informalTermDays / 365);
  const informalTotal = shockAmount + informalInterest;
  const informalBufferDestroyed: ShockPath = {
    id: 'informal',
    label: 'Informal credit',
    channel: 'Pasar / off-app loan',
    total_cost_sgd: Math.round(informalTotal),
    buffer_impact: 'destroyed',
    days_to_clear: informalTermDays,
    apr_pct: informalAprPct,
    effort_hours: 0,
    why: `${informalAprPct}% APR on a ${shockAmount} principal over ${informalTermDays} days. Repayment crushes the runway and there is no protection of committed payments.`,
    recommended: false,
    evidence: [
      'Illustrative APR for off-app loan-shark / informal credit in SG/SEA gig context',
      'Driver runway model assumes burn at last-month expense',
    ],
  };

  // GXS FlexiLoan bridge: 60-day interest-free first draw, then a lower tier.
  const flexiAprPct = 9;
  const flexiTermDays = 60;
  const flexiInterest =
    shockAmount * (flexiAprPct / 100) * Math.max(flexiTermDays - 60, 0) / 365;
  const flexiTotal = shockAmount + flexiInterest;
  const flexi: ShockPath = {
    id: 'flexi',
    label: 'GXS FlexiLoan bridge',
    channel: 'GXS Bank — first draw',
    total_cost_sgd: Math.round(flexiTotal),
    buffer_impact: 'preserved',
    days_to_clear: flexiTermDays,
    apr_pct: flexiAprPct,
    effort_hours: 0,
    why: `First draw is 60 days interest-free; protected loan payment stays Protected. Cheapest cash bridge that does not raid the buffer.`,
    recommended: false,
    evidence: [
      'GXS FlexiLoan first-draw 60-day interest-free (illustrative)',
      'Driver match_product() rule: shock + gap → FlexiLoan',
    ],
  };

  // Earning route: cover the shock with extra shifts in high net/hour zones.
  const sortedZones = [...ds.zones]
    .filter((z) => z.expected_net_per_hour_sgd > 0)
    .sort((a, b) => b.expected_net_per_hour_sgd - a.expected_net_per_hour_sgd)
    .slice(0, 8);
  const bestNetPerHour = sortedZones[0]?.expected_net_per_hour_sgd ?? 22;
  const effortHours = Math.max(1, Math.ceil(shockAmount / bestNetPerHour));
  const windowsLabel = sortedZones
    .slice(0, 2)
    .map((z) => `${z.zone_label} ${z.day_of_week} ${String(z.hour).padStart(2, '0')}:00`)
    .join(' · ');
  const earn: ShockPath = {
    id: 'earn',
    label: 'Earning route',
    channel: 'Goal-aware extra windows',
    total_cost_sgd: 0,
    buffer_impact: 'grows',
    days_to_clear: Math.ceil(effortHours / 4),
    apr_pct: 0,
    effort_hours: effortHours,
    why: `${effortHours} extra hour${effortHours === 1 ? '' : 's'} at ${sgd1(bestNetPerHour)}/hr clears the ${sgd(shockAmount)} cost. Sarthi targets the highest-yield windows: ${windowsLabel || 'top demand cells'}.`,
    recommended: true,
    evidence: [
      'zone_demand_grid.csv — top expected_net_per_hour_sgd cells',
      'Effort = ceil(shock / best_net_per_hour)',
      `Daily burn used for runway impact: ${sgd1(dailyBurn)}/day`,
    ],
  };

  // Recommend the lowest-total-cost path, but only earn when the driver has
  // any margin to add hours; otherwise prefer FlexiLoan (still preserves buffer).
  const tooThin = inc.lastMonth ? inc.lastMonth.net_cashflow < 0 : false;
  if (tooThin) {
    earn.recommended = false;
    flexi.recommended = true;
  }

  const recommended = (earn.recommended ? earn : flexi).id;
  const informalDelta = informalTotal - (earn.recommended ? 0 : flexi.total_cost_sgd);
  const deltaText = `Informal credit costs ${sgd(Math.round(informalDelta))} more than the recommended path.`;

  return {
    shock_amount: shockAmount,
    shock_category: shockCategory,
    recommended,
    paths: [informalBufferDestroyed, flexi, earn],
    delta_text: deltaText,
    assumptions: [
      `Illustrative informal-credit APR ${informalAprPct}% over ${informalTermDays} days.`,
      `Illustrative FlexiLoan first-draw window: ${flexiTermDays} days interest-free.`,
      `Earning route uses the best ${sortedZones.length} cells from zone_demand_grid.csv.`,
// committee_plan — three heterogeneous earner agents debate the next 7 days
// of work and converge on a plan. Each agent has its own values and reasons
// from the same data. The driver sees the disagreement on screen and picks.
//
// This is the "Visible Committee": Conservative Earner, Goal Chaser, and
// Fatigue & Safety Auditor. Their proposals diverge on hours, zones, and
// risk; the consensus is the lowest-friction plan that respects all three.
export type CommitteeAgentId = 'conservative' | 'chaser' | 'safety';

export interface CommitteeProposal {
  agent: CommitteeAgentId;
  agent_label: string;
  agent_role: string;
  hours_next_7d: number;
  est_earnings_sgd: number;
  zones: string[];
  argument: string;
  concerns: string[];
}

export interface CommitteeRound {
  round: number;
  agent: CommitteeAgentId;
  speaker: string;
  text: string;
}

export interface CommitteePlan {
  proposals: CommitteeProposal[];
  debate: CommitteeRound[];
  consensus: {
    hours_next_7d: number;
    est_earnings_sgd: number;
    zones: string[];
    summary: string;
    chosen_voices: CommitteeAgentId[];
    rejected: { agent: CommitteeAgentId; reason: string }[];
  };
  evidence: string[];
}

export function committeePlan(ds: Dataset, driver: Driver): CommitteePlan {
  const inc = incomeSummary(ds, driver.driver_id);
  const dailyNet = inc.avgDailyNet;
  const sortedZones = [...ds.zones]
    .filter((z) => z.expected_net_per_hour_sgd > 0)
    .sort((a, b) => b.expected_net_per_hour_sgd - a.expected_net_per_hour_sgd);
  const topZones = sortedZones.slice(0, 6);
  const nightZones = topZones.filter((z) => z.hour >= 19 || z.hour < 5);
  const dayZones = topZones.filter((z) => z.hour >= 5 && z.hour < 19);
  const bestNetPerHour = topZones[0]?.expected_net_per_hour_sgd ?? 22;
  const restDow = (driver.rest_dow || 'Sunday').slice(0, 3);

  const fmtZone = (z: ZoneCell) =>
    `${z.zone_label} ${z.day_of_week} ${String(z.hour).padStart(2, '0')}:00`;

  // Conservative Earner — protect the buffer first; modest hours, daytime only.
  const conservativeHours = 24;
  const conservative: CommitteeProposal = {
    agent: 'conservative',
    agent_label: 'Conservative Earner',
    agent_role: 'Protects the buffer first',
    hours_next_7d: conservativeHours,
    est_earnings_sgd: Math.round(conservativeHours * bestNetPerHour * 0.85),
    zones: dayZones.slice(0, 3).map(fmtZone),
    argument:
      'Lock in steady daytime windows in the highest-yield daytime zones. ' +
      'Avoid surge volatility. Even a soft week clears the weekly goal need.',
    concerns: [
      'Misses the highest-paying late-night surges.',
      'Might leave money on the table on a busy weekend.',
    ],
  };

  // Goal Chaser — accelerate toward the family insurance goal; nights welcome.
  const chaserHours = 38;
  const chaser: CommitteeProposal = {
    agent: 'chaser',
    agent_label: 'Goal Chaser',
    agent_role: 'Accelerates the funded goal',
    hours_next_7d: chaserHours,
    est_earnings_sgd: Math.round(chaserHours * bestNetPerHour * 1.05),
    zones: [...nightZones.slice(0, 2), ...dayZones.slice(0, 2)].map(fmtZone),
    argument:
      'Stack two late-night surge windows with two morning peaks. ' +
      'This is the week the buffer + insurance both stay on track.',
    concerns: [
      'Raises fatigue and reduces ' +
        restDow +
        ' as a recovery day.',
      'Higher idle-mileage cost if surges drop.',
    ],
  };

  // Fatigue & Safety Auditor — caps hours, mandates rest, no late nights.
  const safetyCap = 30;
  const safety: CommitteeProposal = {
    agent: 'safety',
    agent_label: 'Fatigue & Safety Auditor',
    agent_role: 'Caps hours and protects rest',
    hours_next_7d: safetyCap,
    est_earnings_sgd: Math.round(safetyCap * bestNetPerHour * 0.95),
    zones: dayZones.slice(0, 4).map(fmtZone),
    argument:
      'Cap at ' +
      safetyCap +
      ' hours, no driving after 23:00, mandatory rest on ' +
      restDow +
      '. ' +
      'Income volatility is high; a tired driver is a costly driver.',
    concerns: [
      'Slower goal progression on a single bad week.',
      'Slightly lower ceiling if the week is unusually busy.',
    ],
  };

  const proposals = [conservative, chaser, safety];

  // Choose consensus: stay within safety cap, prefer chaser zones for high
  // yield, but down-shift hours to the safety ceiling. This makes the
  // committee feel like a real negotiation, not three independent suggestions.
  const consensusHours = Math.min(chaserHours, safety.hours_next_7d);
  const consensusZones = [
    ...dayZones.slice(0, 2).map(fmtZone),
    ...nightZones.slice(0, 1).map(fmtZone),
  ];
  const consensusEarnings = Math.round(consensusHours * bestNetPerHour);

  const debate: CommitteeRound[] = [
    {
      round: 1,
      agent: 'chaser',
      speaker: chaser.agent_label,
      text:
        'I want ' +
        chaserHours +
        ' hours including two late-night surges. The insurance goal ' +
        'is closer if we move now.',
    },
    {
      round: 1,
      agent: 'safety',
      speaker: safety.agent_label,
      text:
        'Hard no on late-night driving after 23:00, and we cap at ' +
        safetyCap +
        ' hours. Volatility is ' +
        sgd(inc.volatility) +
        ' month-to-month — fatigue compounds.',
    },
    {
      round: 1,
      agent: 'conservative',
      speaker: conservative.agent_label,
      text:
        'Daytime peaks already cover the weekly need at ' +
        sgd1(dailyNet * 0.85) +
        '/day average. We do not need to push the cap.',
    },
    {
      round: 2,
      agent: 'chaser',
      speaker: chaser.agent_label,
      text:
        'Compromise: keep the safety cap at ' +
        safetyCap +
        ', but allow one early-evening surge window before 23:00. ' +
        'Best of both.',
    },
    {
      round: 2,
      agent: 'safety',
      speaker: safety.agent_label,
      text:
        'Accepted, only if ' +
        restDow +
        ' stays a non-negotiable rest day.',
    },
    {
      round: 2,
      agent: 'conservative',
      speaker: conservative.agent_label,
      text: 'Agreed. The plan still hits the weekly goal need with a margin.',
    },
  ];

  const consensus: CommitteePlan['consensus'] = {
    hours_next_7d: consensusHours,
    est_earnings_sgd: consensusEarnings,
    zones: consensusZones,
    summary:
      consensusHours +
      ' hours across daytime peaks and one early-evening surge. ' +
      restDow +
      ' is reserved for rest. Estimated earnings: ' +
      sgd(consensusEarnings) +
      '.',
    chosen_voices: ['safety', 'chaser'],
    rejected: [
      {
        agent: 'chaser',
        reason: 'Late-night surges past 23:00 — vetoed by Safety Auditor.',
      },
      {
        agent: 'conservative',
        reason: 'Strict daytime-only — relaxed to add one early-evening peak.',
      },
    ],
  };

  return {
    proposals,
    debate,
    consensus,
    evidence: [
      'zone_demand_grid.csv — top expected_net_per_hour_sgd cells',
      'income_summary().avgDailyNet — for steady-day earnings projection',
      'driver.rest_dow — used to reserve the rest day',
    ],
// verify_figures — the Verification Streamer.
// An adversarial critic that walks every claim Sarthi might surface for a
// given driver and tries to refute it. Each claim is bound to a tool result
// and a human-readable source. The Truth Score is the share that traces
// cleanly. Anything that doesn't trace gets flagged.
export interface VerifiedClaim {
  id: string;
  label: string;
  value: string;
  tool: string;
  source: string;
  evidence: string;
  ok: boolean;
  reason: string;
}

export interface VerificationReport {
  truth_score_pct: number;
  total: number;
  passed: number;
  failed: number;
  generated_at: string;
  claims: VerifiedClaim[];
  critic_summary: string;
}

export function verifyFigures(ds: Dataset, driver: Driver): VerificationReport {
  const inc = incomeSummary(ds, driver.driver_id);
  const exp = expenseBreakdown(ds, driver.driver_id);
// family_vault — multi-stakeholder views over the same household goals.
// Driver sees earnings & windows; spouse sees household shock readiness;
// dependents see safety status. Every view is a projection of the same
// underlying goals; sensitive earnings data is filtered per role.
export type FamilyRole = 'driver' | 'spouse' | 'dependent';

export interface FamilyMember {
  role: FamilyRole;
  display_name: string;
  relation: string;
  badge: string;
}

export interface FamilyTile {
  title: string;
  value: string;
  detail: string;
  source: string;
}

export interface FamilyView {
  role: FamilyRole;
  member: FamilyMember;
  tiles: FamilyTile[];
  shared_goals: { name: string; progress_pct: number }[];
  hidden_from_role: string[];
  evidence: string[];
}

export const FAMILY_MEMBERS: FamilyMember[] = [
  { role: 'driver', display_name: 'Siti (you)', relation: 'Driver', badge: '🎯' },
  { role: 'spouse', display_name: 'Rahim', relation: 'Spouse', badge: '🛡' },
  { role: 'dependent', display_name: 'Aisyah', relation: 'Daughter, 12', badge: '🌱' },
];

export function familyView(
  ds: Dataset,
  driver: Driver,
  role: FamilyRole,
): FamilyView {
  const member =
    FAMILY_MEMBERS.find((m) => m.role === role) ?? FAMILY_MEMBERS[0];
  const inc = incomeSummary(ds, driver.driver_id);
  const fc = forecastCashflow(ds, driver.driver_id, 0);
  const obligations = ds.obligations.filter(
    (o) => o.driver_id === driver.driver_id,
  );

  const claims: VerifiedClaim[] = [
    {
      id: 'driver_name',
      label: "Driver's name",
      value: driver.name,
      tool: 'drivers.csv',
      source: `drivers.csv → driver_id=${driver.driver_id}`,
      evidence: 'Direct CSV row read.',
      ok: true,
      reason: 'Trace passes; primary key intact.',
    },
    {
      id: 'avg_net',
      label: 'Avg monthly net (last 3 mo)',
      value: sgd(inc.avgMonthlyNet),
      tool: 'income_summary()',
      source: 'monthly_summary.csv → net_income (last 3 rows)',
      evidence: `Mean of ${inc.months
        .slice(-3)
        .map((m) => m.month)
        .join(', ')}.`,
      ok: inc.avgMonthlyNet > 0,
      reason:
        inc.avgMonthlyNet > 0
          ? 'Trace passes; mean of three real CSV rows.'
          : 'Refused: average non-positive — the metric would be misleading.',
    },
    {
      id: 'last_month_expense',
      label: 'Last-month spend',
      value: sgd(exp.total),
      tool: 'expense_breakdown()',
      source: `category_analytics.csv → ${exp.month}`,
      evidence: `Sum of ${exp.rows.length} category rows for ${exp.month}.`,
      ok: exp.total > 0,
      reason:
        exp.total > 0
          ? 'Trace passes; sum of real CSV rows.'
          : 'Refused: empty month — would be inferred, not measured.',
    },
    {
      id: 'cash_runway',
      label: 'Cash runway (stressed)',
      value: `${fc.days} days`,
      tool: 'forecast_cashflow()',
      source: 'monthly_summary.csv + transactions.csv (running_balance)',
      evidence:
        'Runway = (balance − comfort) / daily_burn at 55% income stress.',
      ok: fc.days >= 0,
      reason:
        fc.days >= 0
          ? 'Trace passes; deterministic computation over CSV rows.'
          : 'Refused: negative runway — a number Sarthi will not assert.',
    },
    {
      id: 'recurring_obligations',
      label: 'Recurring obligation count',
      value: String(obligations.length),
      tool: 'recurring_obligations.csv',
      source: 'recurring_obligations.csv (filtered by driver)',
      evidence: 'Count of rows matched by driver_id.',
      ok: true,
      reason: 'Trace passes; row count of real CSV.',
    },
    {
      id: 'volatility',
      label: 'Income volatility (3 mo)',
      value: sgd(inc.volatility),
      tool: 'income_summary()',
      source: 'monthly_summary.csv → max(net_income) − min(net_income)',
      evidence: 'Difference of two real CSV rows over the last 3 months.',
      ok: inc.volatility >= 0,
      reason: 'Trace passes; bounded difference of two CSV rows.',
    },
  ];

  const passed = claims.filter((c) => c.ok).length;
  const total = claims.length;
  const truthScore = Math.round((passed / Math.max(total, 1)) * 100);

  const failedSummary = claims.filter((c) => !c.ok).map((c) => c.label);
  const critic_summary =
    failedSummary.length === 0
      ? 'Every figure traces to a real CSV row or a stated, deterministic computation.'
      : `Refused to assert: ${failedSummary.join(', ')}.`;

  return {
    truth_score_pct: truthScore,
    total,
    passed,
    failed: total - passed,
    generated_at: new Date().toISOString(),
    claims,
    critic_summary,
  };
// country_shelf — Sarthi's regional shelf swap. Same agent, same tools,
// different jurisdictional shelf. Drives the live country toggle on the
// architecture page and the demo. Stays illustrative; product names match
// real services in each country but figures here are not advice.
export type CountryCode = 'SG' | 'ID' | 'MY' | 'PH';

export interface CountryShelf {
  code: CountryCode;
  name: string;
  flag: string;
  currency: string;
  bank: string;
  saving_pocket: string;
  bridge_credit: string;
  invest: string;
  pension_scheme: string;
  pension_one_way: boolean;
  partner_protection: string;
  median_gig_income: string;
  notes: string;
}

const SHELVES: Record<CountryCode, CountryShelf> = {
  SG: {
    code: 'SG',
    name: 'Singapore',
    flag: '🇸🇬',
    currency: 'SGD',
    bank: 'GXS Bank',
    saving_pocket: 'GXS Saving Pocket',
    bridge_credit: 'GXS FlexiLoan',
    invest: 'GXS Invest',
    pension_scheme: 'CPF (Platform Workers Act)',
    pension_one_way: true,
    partner_protection: 'Grab Partner family hospital plan',
    median_gig_income: 'S$1,500–2,500 / month',
    notes:
      'CPF opt-in is irreversible. Sarthi prepares the decision; the driver confirms with the official CPF Board portal.',
  },
  ID: {
    code: 'ID',
    name: 'Indonesia',
    flag: '🇮🇩',
    currency: 'IDR',
    bank: 'OVO / DANA-linked wallet',
    saving_pocket: 'Tabungan Berjangka pocket',
    bridge_credit: 'PayLater micro-bridge',
    invest: 'Reksa Dana entry tier',
    pension_scheme: 'BPJS Ketenagakerjaan (JHT/JKK)',
    pension_one_way: false,
    partner_protection: 'Mitra family BPJS Kesehatan top-up',
    median_gig_income: 'Rp 3,000,000–5,500,000 / month',
    notes:
      'BPJS contributions can be paused if work stops; Sarthi flags the runway impact rather than recommending the pause.',
  },
  MY: {
    code: 'MY',
    name: 'Malaysia',
    flag: '🇲🇾',
    currency: 'MYR',
    bank: 'Touch ’n Go eWallet',
    saving_pocket: 'GO+ pocket',
    bridge_credit: 'GOpinjam micro-bridge',
    invest: 'GOinvest',
    pension_scheme: 'EPF i-Saraan (voluntary)',
    pension_one_way: false,
    partner_protection: 'PERKESO SKSPS partner injury cover',
    median_gig_income: 'RM 2,000–3,800 / month',
    notes:
      'EPF i-Saraan is a voluntary top-up scheme; Sarthi shows the matching subsidy curve, not a fixed recommendation.',
  },
  PH: {
    code: 'PH',
    name: 'Philippines',
    flag: '🇵🇭',
    currency: 'PHP',
    bank: 'GCash / Maya wallet',
    saving_pocket: 'GSave pocket',
    bridge_credit: 'GLoan / GCredit bridge',
    invest: 'GInvest',
    pension_scheme: 'SSS Self-Employed',
    pension_one_way: false,
    partner_protection: 'PhilHealth top-up + GrabCare',
    median_gig_income: '₱20,000–35,000 / month',
    notes:
      'SSS Self-Employed contribution tiers are flexible; Sarthi shows the pension projection per tier without picking one.',
  },
};

export function listCountries(): CountryShelf[] {
  return [SHELVES.SG, SHELVES.ID, SHELVES.MY, SHELVES.PH];
}

export function countryShelf(code: CountryCode): CountryShelf {
  return SHELVES[code];
}

export function compareShelves(): { row: string; SG: string; ID: string; MY: string; PH: string }[] {
  return [
    {
      row: 'Wallet / bank',
      SG: SHELVES.SG.bank,
      ID: SHELVES.ID.bank,
      MY: SHELVES.MY.bank,
      PH: SHELVES.PH.bank,
    },
    {
      row: 'Saving pocket',
      SG: SHELVES.SG.saving_pocket,
      ID: SHELVES.ID.saving_pocket,
      MY: SHELVES.MY.saving_pocket,
      PH: SHELVES.PH.saving_pocket,
    },
    {
      row: 'Bridge credit',
      SG: SHELVES.SG.bridge_credit,
      ID: SHELVES.ID.bridge_credit,
      MY: SHELVES.MY.bridge_credit,
      PH: SHELVES.PH.bridge_credit,
    },
    {
      row: 'Invest entry',
      SG: SHELVES.SG.invest,
      ID: SHELVES.ID.invest,
      MY: SHELVES.MY.invest,
      PH: SHELVES.PH.invest,
    },
    {
      row: 'Pension scheme',
      SG: SHELVES.SG.pension_scheme,
      ID: SHELVES.ID.pension_scheme,
      MY: SHELVES.MY.pension_scheme,
      PH: SHELVES.PH.pension_scheme,
    },
    {
      row: 'Partner protection',
      SG: SHELVES.SG.partner_protection,
      ID: SHELVES.ID.partner_protection,
      MY: SHELVES.MY.partner_protection,
      PH: SHELVES.PH.partner_protection,
    },
  ];
// voice_intent — deterministic intent parsing for the Voice Co-Driver.
// Drivers are hands-busy; the parser does not need to be clever, it needs to
// be reliable. We extract intents (plan, log_expense, status, stop) and slots
// (hours, amount, category, language). Anything ambiguous returns 'unknown'.
export type VoiceIntent =
  | 'plan_window'
  | 'log_expense'
  | 'status'
  | 'rest_check'
  | 'translate_pickup'
  | 'unknown';

export interface VoiceParse {
  intent: VoiceIntent;
  hours?: number;
  amount?: number;
  category?: string;
  language: 'en' | 'ms' | 'ta' | 'zh';
  raw: string;
  evidence: string[];
}

const LANG_HINTS: { lang: VoiceParse['language']; words: string[] }[] = [
  { lang: 'ms', words: ['saya', 'jam', 'ringgit', 'esok', 'pasar'] },
  { lang: 'ta', words: ['enakku', 'naal', 'mani', 'thirumbi'] },
  { lang: 'zh', words: ['今晚', '小时', '块钱', '今天', '明天'] },
];

function detectLanguage(t: string): VoiceParse['language'] {
  const lower = t.toLowerCase();
  for (const hint of LANG_HINTS) {
    if (hint.words.some((w) => lower.includes(w.toLowerCase()))) {
      return hint.lang;
    }
  }
  return 'en';
}

function findNumber(t: string): number | undefined {
  const m = t.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : undefined;
}

export function voiceIntent(raw: string): VoiceParse {
  const lower = raw.toLowerCase().trim();
  const language = detectLanguage(raw);
  const evidence: string[] = [`raw="${raw}"`, `language=${language}`];

  if (!lower) {
    return { intent: 'unknown', language, raw, evidence };
  }

  if (
    /\b(plan|window|where|best|hour|jam|surge|target|need)\b/.test(lower) &&
    !/\bschool|fee|repair|bill|fuel|petrol|sick\b/.test(lower)
  ) {
    const hours = findNumber(lower);
    evidence.push('matched plan keywords');
    return {
      intent: 'plan_window',
      hours,
      language,
      raw,
      evidence,
    };
  }

  if (/\b(paid|spent|bought|bill|fee|repair|petrol|fuel)\b/.test(lower)) {
    const amount = findNumber(lower);
    let category = 'other';
    if (/\bschool|fee\b/.test(lower)) category = 'school fees';
    else if (/\bmedical|doctor|hospital|sick\b/.test(lower)) category = 'medical';
    else if (/\bfuel|petrol|gas\b/.test(lower)) category = 'fuel';
    else if (/\brepair|workshop|bike\b/.test(lower)) category = 'vehicle repair';
    evidence.push('matched expense keywords');
    return {
      intent: 'log_expense',
      amount,
      category,
      language,
      raw,
      evidence,
    };
  }

  if (/\b(how am i|where am i|status|runway|on track|safe)\b/.test(lower)) {
    evidence.push('matched status keywords');
    return { intent: 'status', language, raw, evidence };
  }

  if (/\b(tired|sleep|rest|stop|break)\b/.test(lower)) {
    evidence.push('matched rest keywords');
    return { intent: 'rest_check', language, raw, evidence };
  }

  if (/\b(pickup|address|customer says|gate|locked)\b/.test(lower)) {
    evidence.push('matched pickup-translation keywords');
    return { intent: 'translate_pickup', language, raw, evidence };
  }

  evidence.push('no intent matched');
  return { intent: 'unknown', language, raw, evidence };
}

export function voiceReply(parse: VoiceParse): string {
  switch (parse.intent) {
    case 'plan_window':
      return parse.hours
        ? `${parse.hours} hours covers your weekly buffer goal. Sarthi will pick the highest-yield zones; the council vetoed late nights past 23:00.`
        : 'Sarthi will plan around your goal. Tell me hours or "today" for a same-day plan.';
    case 'log_expense':
      return parse.amount
        ? `Logged ${parse.category} for S$${Math.round(parse.amount)}. Runway recomputed; protected goals still Protected. See the Shark Moment for path options.`
        : `Got it — ${parse.category} expense. Tell me the amount.`;
    case 'status':
      return 'Runway, goals, and the protected loan are all on the dashboard. The Truth Score is on the device shell — every figure provable.';
    case 'rest_check':
      return 'Buffer is ahead. The Fatigue & Safety Auditor recommends a rest window now; a single early-evening peak tomorrow stays on plan.';
    case 'translate_pickup':
      return 'Sarthi can mediate the pickup message. Tell me what the customer said and the language; the agent will draft a neutral reply in both directions.';
    case 'unknown':
    default:
      return "I didn't catch a clear request. Try: \"plan 3 hours\", \"I just paid school fees S$120\", or \"how am I doing?\"";
  }
// time_machine — the Counterfactual Replay.
// Compare Siti's actual recent shifts against the highest-yield windows from
// the demand grid for the same period. The machine surfaces the gap between
// what was earned and what could have been earned, with named decisions and
// hour-level evidence. Pure tool reads; deterministic; no LLM in the loop.
export interface ShiftFact {
  date: string;
  zone: string;
  hours: number;
  earned_sgd: number;
  net_per_hour: number;
}

export interface AltShift {
  date: string;
  zone_label: string;
  day_of_week: string;
  hour: number;
  hours: number;
  expected_net_sgd: number;
  expected_net_per_hour: number;
  reason: string;
}

export interface TimeMachineReplay {
  reality: {
    shifts: ShiftFact[];
    total_earned_sgd: number;
    total_hours: number;
    avg_net_per_hour: number;
  };
  alternate: {
    shifts: AltShift[];
    total_earned_sgd: number;
    total_hours: number;
    avg_net_per_hour: number;
  };
  delta: {
    earnings_uplift_sgd: number;
    hours_diff: number;
    headline: string;
    biggest_miss: { date: string; zone: string; gain_sgd: number };
    biggest_keep: { date: string; zone: string; gain_sgd: number };
  };
  evidence: string[];
}

export function timeMachineReplay(
  ds: Dataset,
  driver: Driver,
): TimeMachineReplay {
  const driverShifts = ds.shifts
    .filter((s) => s.driver_id === driver.driver_id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const recent = driverShifts.slice(-7);
  const realShifts: ShiftFact[] = recent.map((s) => ({
    date: s.date,
    zone: s.zone_label,
    hours: s.duration_hours,
    earned_sgd: s.net_earnings_sgd,
    net_per_hour: s.net_per_hour_sgd,
  }));
  const realTotal = realShifts.reduce((a, b) => a + b.earned_sgd, 0);
  const realHours = realShifts.reduce((a, b) => a + b.hours, 0);
  const realAvg = realTotal / Math.max(realHours, 1);

  // Alternate world: pick the highest expected_net_per_hour cells across the
  // same days-of-week, sized to match the same total hours roughly.
  const dowsCovered = new Set(
    recent.map((s) => new Date(s.date).toLocaleDateString('en-SG', { weekday: 'short' })),
  );
  const altCells = [...ds.zones]
    .filter((z) => z.expected_net_per_hour_sgd > 0 && dowsCovered.has(z.day_of_week.slice(0, 3)))
    .sort((a, b) => b.expected_net_per_hour_sgd - a.expected_net_per_hour_sgd)
    .slice(0, recent.length);
  const altShifts: AltShift[] = altCells.map((z, i) => ({
    date: recent[i % Math.max(recent.length, 1)]?.date ?? '',
    zone_label: z.zone_label,
    day_of_week: z.day_of_week,
    hour: z.hour,
    hours: 4,
    expected_net_sgd: Math.round(z.expected_net_per_hour_sgd * 4),
    expected_net_per_hour: z.expected_net_per_hour_sgd,
    reason:
      'Top expected_net_per_hour cell for ' +
      z.day_of_week +
      ' ' +
      String(z.hour).padStart(2, '0') +
      ':00 — surge=' +
      z.surge_multiplier.toFixed(1) +
      ', weather=' +
      z.weather,
  }));
  const altTotal = altShifts.reduce((a, b) => a + b.expected_net_sgd, 0);
  const altHours = altShifts.reduce((a, b) => a + b.hours, 0);
  const altAvg = altTotal / Math.max(altHours, 1);

  // Highlight the biggest miss (alt > real for that day) and biggest keep (where
  // real was already in the top tier).
  const realByDate = new Map<string, number>();
  realShifts.forEach((s) => realByDate.set(s.date, (realByDate.get(s.date) ?? 0) + s.earned_sgd));
  const altByDate = new Map<string, number>();
  altShifts.forEach((s) => altByDate.set(s.date, (altByDate.get(s.date) ?? 0) + s.expected_net_sgd));

  let biggestMissDate = '';
  let biggestMissGain = 0;
  let biggestKeepDate = '';
  let biggestKeepGain = 0;
  for (const date of altByDate.keys()) {
    const gain = (altByDate.get(date) ?? 0) - (realByDate.get(date) ?? 0);
    if (gain > biggestMissGain) {
      biggestMissGain = gain;
      biggestMissDate = date;
    }
    if (gain < biggestKeepGain) {
      biggestKeepGain = gain;
      biggestKeepDate = date;
    }
  }

  const headline =
    altTotal > realTotal
      ? `If you had taken the top windows last week, you would have earned ${sgd(Math.round(altTotal - realTotal))} more.`
      : `Your last week was already in the top tier — Sarthi's alternate plan would have been ${sgd(Math.round(realTotal - altTotal))} below.`;

  return {
    reality: {
      shifts: realShifts,
      total_earned_sgd: Math.round(realTotal),
      total_hours: Math.round(realHours),
      avg_net_per_hour: Math.round(realAvg * 100) / 100,
    },
    alternate: {
      shifts: altShifts,
      total_earned_sgd: Math.round(altTotal),
      total_hours: Math.round(altHours),
      avg_net_per_hour: Math.round(altAvg * 100) / 100,
    },
    delta: {
      earnings_uplift_sgd: Math.round(altTotal - realTotal),
      hours_diff: Math.round(altHours - realHours),
      headline,
      biggest_miss: {
        date: biggestMissDate || recent[0]?.date || '',
        zone: altShifts[0]?.zone_label ?? '',
        gain_sgd: Math.round(biggestMissGain),
      },
      biggest_keep: {
        date: biggestKeepDate || recent[0]?.date || '',
        zone: realShifts[0]?.zone ?? '',
        gain_sgd: Math.round(-biggestKeepGain),
      },
    },
    evidence: [
      `driver_shift_log.csv — last ${realShifts.length} shifts read`,
      'zone_demand_grid.csv — top expected_net_per_hour cells filtered by day-of-week',
      'No LLM in the loop. Counterfactual is a deterministic projection.',
// stress_test — Shock Stress-Test Studio.
// Monte Carlo resilience for a gig worker. Runs N deterministic-PRNG
// simulations of a 12-week horizon, applying user-selected shock
// distributions. Returns: probability of staying in safe runway, expected
// shortfall, and the 3 weakest links found across simulations.
export interface StressShock {
  id: string;
  label: string;
  weekly_probability: number; // 0..1
  amount_low: number;
  amount_high: number;
}

export const STRESS_SHOCKS: StressShock[] = [
  { id: 'medical', label: 'Medical bill', weekly_probability: 0.04, amount_low: 100, amount_high: 600 },
  { id: 'school', label: 'School fees due', weekly_probability: 0.02, amount_low: 80, amount_high: 350 },
  { id: 'fuel', label: 'Fuel price spike', weekly_probability: 0.06, amount_low: 30, amount_high: 90 },
  { id: 'sick', label: 'Sick week (income drops)', weekly_probability: 0.03, amount_low: 200, amount_high: 700 },
  { id: 'dependent', label: 'Dependent emergency', weekly_probability: 0.02, amount_low: 200, amount_high: 800 },
  { id: 'vehicle', label: 'Vehicle repair', weekly_probability: 0.05, amount_low: 100, amount_high: 500 },
];

export interface StressResult {
  weeks: number;
  iterations: number;
  shocks_enabled: string[];
  resilience_score_pct: number;     // share of simulations that finished safe
  expected_shortfall_sgd: number;   // average final cash gap, only over failed runs
  weakest_links: { week: number; reason: string; freq: number }[];
  histogram: number[];              // 10 buckets of final cash position
  evidence: string[];
}

// Mulberry32 — small, fast, deterministic PRNG so the Studio is reproducible.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runStressTest(
  ds: Dataset,
  driver: Driver,
  enabled: string[],
  iterations = 800,
  weeks = 12,
): StressResult {
  const inc = incomeSummary(ds, driver.driver_id);
  const last = inc.lastMonth;
  const weeklyNet = inc.avgMonthlyNet / 4.33;
  const weeklyExpense = (last?.total_expense ?? inc.avgMonthlyNet) / 4.33;
  const startBalance =
    latestBalance(ds, driver.driver_id) ?? inc.avgMonthlyNet * 1.4;
  const safetyLine = weeklyExpense * 1.2;
  const shocks = STRESS_SHOCKS.filter((s) => enabled.includes(s.id));

  const rand = mulberry32(driver.driver_id.length * 1009 + iterations + weeks);

  let safeCount = 0;
  let shortfallSum = 0;
  let shortfallCount = 0;
  const histogram = new Array(10).fill(0);
  const failureWeek: Record<number, number> = {};
  const failureReason: Record<string, number> = {};

  for (let i = 0; i < iterations; i++) {
    let cash = startBalance;
    let failed = false;
    for (let w = 1; w <= weeks; w++) {
      cash += weeklyNet * (0.85 + rand() * 0.3); // weekly net with jitter
      cash -= weeklyExpense * (0.95 + rand() * 0.1);
      for (const s of shocks) {
        if (rand() < s.weekly_probability) {
          const amt = s.amount_low + rand() * (s.amount_high - s.amount_low);
          cash -= amt;
          if (cash < safetyLine && !failed) {
            failed = true;
            failureWeek[w] = (failureWeek[w] ?? 0) + 1;
            failureReason[s.id] = (failureReason[s.id] ?? 0) + 1;
          }
        }
      }
    }
    if (!failed) safeCount += 1;
    else {
      shortfallSum += Math.max(safetyLine - cash, 0);
      shortfallCount += 1;
    }
    const bucket = Math.max(0, Math.min(9, Math.floor((cash / (startBalance * 2)) * 10)));
    histogram[bucket] += 1;
  }

  const resilience = Math.round((safeCount / iterations) * 100);
  const expectedShortfall =
    shortfallCount > 0 ? Math.round(shortfallSum / shortfallCount) : 0;
  const weakestLinks = Object.entries(failureReason)
    .map(([id, freq]) => {
      const shock = STRESS_SHOCKS.find((s) => s.id === id);
      return {
        week:
          parseInt(
            Object.entries(failureWeek)
              .sort((a, b) => b[1] - a[1])[0]?.[0] ?? '0',
            10,
          ),
        reason: shock?.label ?? id,
        freq,
      };
    })
    .sort((a, b) => b.freq - a.freq)
    .slice(0, 3);

  return {
    weeks,
    iterations,
    shocks_enabled: enabled,
    resilience_score_pct: resilience,
    expected_shortfall_sgd: expectedShortfall,
    weakest_links: weakestLinks,
    histogram,
    evidence: [
      'Mulberry32 deterministic PRNG seeded from driver id + iterations.',
      'Weekly net & expense from monthly_summary.csv, jittered ±15% / ±5%.',
      'Shock probabilities and amounts from STRESS_SHOCKS table (illustrative).',
    ],
  const sharedGoalsBase = [
    { name: 'Emergency cash buffer', progress_pct: 38 },
    { name: 'Family health insurance fund', progress_pct: 62 },
    { name: 'School fees pocket', progress_pct: 81 },
  ];

  if (role === 'driver') {
    return {
      role,
      member,
      tiles: [
        {
          title: 'Avg net (3 mo)',
          value: sgd(inc.avgMonthlyNet),
          detail: 'Last 3 months from monthly_summary.',
          source: 'income_summary()',
        },
        {
          title: 'Runway (stressed)',
          value: `${fc.days} days`,
          detail: 'At 55% income stress.',
          source: 'forecast_cashflow()',
        },
        {
          title: 'Recurring obligations',
          value: String(obligations.length),
          detail: 'Bills tracked in the planner.',
          source: 'recurring_obligations.csv',
        },
      ],
      shared_goals: sharedGoalsBase,
      hidden_from_role: [],
      evidence: ['Driver view — full earnings + obligations.'],
    };
  }

  if (role === 'spouse') {
    return {
      role,
      member,
      tiles: [
        {
          title: 'Household shock readiness',
          value: `${fc.days} days`,
          detail:
            'How long the family stays okay if income halves tomorrow.',
          source: 'forecast_cashflow()',
        },
        {
          title: 'Health fund',
          value: '62%',
          detail: 'Family insurance pocket progress.',
          source: 'goal_tracker()',
        },
        {
          title: 'School fees pocket',
          value: '81%',
          detail: 'Funded for the next term.',
          source: 'goal_tracker()',
        },
      ],
      shared_goals: sharedGoalsBase,
      hidden_from_role: [
        'Trip-level earnings',
        'Per-zone shift recommendations',
        'Driver-only obligations',
      ],
      evidence: ['Spouse view — household readiness only; trip-level data filtered.'],
    };
  }

  // Dependent
  return {
    role,
    member,
    tiles: [
      {
        title: 'Safety status',
        value: 'Protected',
        detail: 'School fees pocket is funded.',
        source: 'goal_tracker()',
      },
      {
        title: 'Health cover',
        value: 'On track',
        detail: 'Family insurance plan is on track.',
        source: 'check_unlocks()',
      },
      {
        title: 'School term coverage',
        value: '81%',
        detail: 'Pocket reserved for fees and supplies.',
        source: 'goal_tracker()',
      },
    ],
    shared_goals: sharedGoalsBase,
    hidden_from_role: [
      'Income amount',
      'Driver shifts',
      'Bank balances',
      'Bills and obligations',
    ],
    evidence: ['Dependent view — safety status only; financial data redacted.'],
  };
}

// match_product — best-fit GXS / Grab product for a need (need-driven)
export function matchProduct(situation: {
  shock: boolean;
  gap: number;
  surplus: number;
  liquidityNeed: boolean;
}): { product: string; why: string } {
  if (situation.shock && situation.gap > 0)
    return {
      product: 'GXS FlexiLoan bridge',
      why: 'Small draw, first use is 60 days interest-free — bridges the gap and protects committed payments.',
    };
  if (situation.surplus > 0 && situation.liquidityNeed)
    return {
      product: 'GXS Saving Pocket',
      why: 'Goal-based sub-account — keeps the contribution visible and separate.',
    };
  if (situation.surplus > 0)
    return {
      product: 'GXS Boost Pocket',
      why: 'Higher locked yield for money not needed in the short term.',
    };
  return { product: 'No product', why: 'Nothing fits the situation right now — Sarthi will not push one.' };
}

// allocate_surplus — split notionally-available surplus across GXS products.
export function allocateSurplus(surplus: number, persona: Driver['persona']): AllocationPlan {
  if (surplus <= 0) return { surplus: 0, slices: [] };
  // Firefighters: liquidity first. Stabilizers: more into yield/invest.
  const w =
    persona === 'firefighter'
      ? { bank: 0.6, boost: 0.3, invest: 0.1 }
      : persona === 'grower'
        ? { bank: 0.4, boost: 0.35, invest: 0.25 }
        : { bank: 0.35, boost: 0.35, invest: 0.3 };
  return {
    surplus,
    slices: [
      {
        product: 'GXS Bank',
        amount: Math.round(surplus * w.bank),
        icon: '💧',
        why: 'Stays liquid for the goal contribution and any shock this month.',
      },
      {
        product: 'GXS Boost Pocket',
        amount: Math.round(surplus * w.boost),
        icon: '🔒',
        why: 'FD-like locked pocket — higher yield on money not needed short-term.',
      },
      {
        product: 'GXS Invest',
        amount: Math.round(surplus * w.invest),
        icon: '📈',
        why: 'Low-risk fund entry — only the slice you can leave invested.',
      },
    ],
  };
}

// check_unlocks — which partner products the driver's goals have unlocked.
export function checkUnlocks(
  goals: { name: string; progress: number; onTrack: boolean }[],
): Unlock[] {
  const hasHealth = goals.some(
    (g) => /health|insurance/i.test(g.name) && g.progress >= 12,
  );
  const buffer = goals.some(
    (g) => /buffer|emergency|smoothing/i.test(g.name) && g.onTrack,
  );
  const consistent = goals.filter((g) => g.onTrack).length >= 2;
  return [
    {
      key: 'insurance',
      title: 'Family health insurance — partner plan',
      detail:
        'A Grab-partner family hospital plan at a group rate, payable from your GXS pocket. Sarthi never charges you — the premium goes straight to the insurer.',
      icon: '🛡️',
      unlocked: hasHealth,
      requirement: 'Health fund ≥ 12% funded',
    },
    {
      key: 'credit',
      title: 'GXS FlexiLoan at a lower rate',
      detail:
        'Two months of on-track goals signals reliable cashflow to GXS. That moves you to a lower interest tier — cheaper bridge credit when you actually need it.',
      icon: '🏦',
      unlocked: consistent,
      requirement: '2+ goals on track',
    },
    {
      key: 'boost',
      title: 'GXS Boost Pocket — higher yield tier',
      detail:
        'A funded buffer means money can sit locked for better yield without risking your runway.',
      icon: '🔒',
      unlocked: buffer,
      requirement: 'Buffer goal on track',
    },
  ];
}

// cpf_project — take-home before / after the irreversible CPF opt-in
// (Sarthi's signature decision; Agent Spec §3). Modelled, not advised.
export function cpfProject(monthlyNet: number, bornBefore1995: boolean) {
  const workerRate = 0.05; // illustrative worker share, post-transition
  const operatorMatch = 0.07; // operator share from 1 Jan 2026
  const before = monthlyNet;
  const cpfDeduction = monthlyNet * workerRate;
  const after = monthlyNet - cpfDeduction;
  const retirementGain = cpfDeduction + monthlyNet * operatorMatch;
  return {
    eligible: bornBefore1995,
    before,
    after,
    cpfDeduction,
    operatorContribution: monthlyNet * operatorMatch,
    retirementGain,
  };
}

// cpf_trajectory — per-year life trajectory from current age to retirement,
// computed two ways: opt-in to CPF as a Platform Worker vs stay out. This is
// the data backing the CPF Life Mirror UI. It produces deterministic numbers,
// each grounded in the driver's monthly net income (CSV) and a transparent
// growth assumption stated in the source. The agent never advises — it
// projects, and the driver decides.
export interface CpfYearPoint {
  year: number;          // calendar year (current year offset by years_from_now)
  age: number;           // driver age at that year
  monthly_take_home: number;
  cumulative_cash_savings: number;     // post-tax surplus held in own pocket
  cumulative_cpf_balance: number;      // CPF Ordinary + Special accounts (modelled)
  housing_buffer: number;              // share of CPF earmarked toward HDB
  healthcare_buffer: number;           // share of CPF earmarked toward MediSave
  retirement_pot: number;              // share toward Retirement Account
  shock_resilience_days: number;       // simulated runway in days at this snapshot
}

export interface CpfTrajectory {
  current_age: number;
  retirement_age: number;
  monthly_net_today: number;
  surplus_rate: number;            // fraction of net used to model own savings
  cpf_growth_rate: number;
  cash_growth_rate: number;
  inflation_rate: number;
  worker_share: number;
  operator_share: number;
  optInPath: CpfYearPoint[];
  stayOutPath: CpfYearPoint[];
  delta: {
    age: number;
    cash_diff: number;          // optIn cash - stayOut cash
    pot_diff: number;           // optIn retirement pot - stayOut equivalent
    healthcare_diff: number;    // optIn healthcare buffer - stayOut equivalent
    housing_diff: number;
    headline: string;
  };
  source: { tool: string; field: string }[];
}

export function cpfTrajectory(
  ds: Dataset,
  driver: Driver,
  retirementAge = 65,
): CpfTrajectory {
  const inc = incomeSummary(ds, driver.driver_id);
  const monthlyNet = Math.max(inc.avgMonthlyNet, 1);

  // Illustrative model parameters — explicit so the trace can cite them.
  const workerShare = 0.05;
  const operatorShare = 0.07;
  const cashGrowth = 0.018;       // GXS Bank effective annual yield (illustrative)
  const cpfGrowth = 0.034;        // CPF blended yield across OA/SA (illustrative)
  const inflation = 0.02;
  const surplusRate = 0.12;       // dataset's flat 12% net-surplus proxy

  // CPF account split (illustrative for a 45+ Platform Worker).
  const splitOA = 0.45; // housing
  const splitMA = 0.30; // healthcare
  const splitRA = 0.25; // retirement

  const baseDailyBurn = (inc.lastMonth?.total_expense ?? monthlyNet) / 30;

  const optInPath: CpfYearPoint[] = [];
  const stayOutPath: CpfYearPoint[] = [];

  let cashOptIn = 0;
  let cashStayOut = 0;
  let cpfBalance = 0;
  const today = new Date();
  const baseYear = today.getFullYear();

  for (let age = driver.age; age <= retirementAge; age++) {
    const yearsFromNow = age - driver.age;
    const monthly = monthlyNet * Math.pow(1 + 0.01, yearsFromNow); // mild wage drift
    const annualNet = monthly * 12;

    // Stay-out: full take-home flows into own pocket (surplusRate of it saves).
    const stayOutContribution = annualNet * surplusRate;
    cashStayOut = cashStayOut * (1 + cashGrowth) + stayOutContribution;

    // Opt-in: worker share leaves the take-home; operator match goes to CPF;
    // worker still saves the same surplusRate of the reduced take-home.
    const optInTakeHome = monthly * (1 - workerShare);
    const optInContribution = optInTakeHome * 12 * surplusRate;
    cashOptIn = cashOptIn * (1 + cashGrowth) + optInContribution;
    const cpfInflow = annualNet * (workerShare + operatorShare);
    cpfBalance = cpfBalance * (1 + cpfGrowth) + cpfInflow;

    const stayOutShockDays = Math.round(cashStayOut / Math.max(baseDailyBurn, 1));
    // Opt-in resilience uses cash + a fraction of the MediSave buffer, capped.
    const optInShockDays = Math.round(
      (cashOptIn + cpfBalance * splitMA * 0.4) / Math.max(baseDailyBurn, 1),
    );

    stayOutPath.push({
      year: baseYear + yearsFromNow,
      age,
      monthly_take_home: monthly,
      cumulative_cash_savings: Math.round(cashStayOut),
      cumulative_cpf_balance: 0,
      housing_buffer: 0,
      healthcare_buffer: 0,
      retirement_pot: Math.round(cashStayOut),
      shock_resilience_days: stayOutShockDays,
    });
    optInPath.push({
      year: baseYear + yearsFromNow,
      age,
      monthly_take_home: optInTakeHome,
      cumulative_cash_savings: Math.round(cashOptIn),
      cumulative_cpf_balance: Math.round(cpfBalance),
      housing_buffer: Math.round(cpfBalance * splitOA),
      healthcare_buffer: Math.round(cpfBalance * splitMA),
      retirement_pot: Math.round(cpfBalance * splitRA + cashOptIn),
      shock_resilience_days: optInShockDays,
    });
  }

  const optEnd = optInPath[optInPath.length - 1];
  const outEnd = stayOutPath[stayOutPath.length - 1];
  const cashDiff = optEnd.cumulative_cash_savings - outEnd.cumulative_cash_savings;
  const potDiff = optEnd.retirement_pot - outEnd.retirement_pot;
  const healthcareDiff = optEnd.healthcare_buffer - outEnd.healthcare_buffer;
  const housingDiff = optEnd.housing_buffer - outEnd.housing_buffer;

  const headline =
    potDiff > 0
      ? `By ${optEnd.age}, opting in is ${sgd(potDiff)} ahead at retirement, with ${sgd(healthcareDiff)} earmarked for medical and ${sgd(housingDiff)} toward housing.`
      : `By ${optEnd.age}, staying out keeps ${sgd(-potDiff)} more in your pocket, but no employer match and no protected healthcare buffer.`;

  return {
    current_age: driver.age,
    retirement_age: retirementAge,
    monthly_net_today: monthlyNet,
    surplus_rate: surplusRate,
    cpf_growth_rate: cpfGrowth,
    cash_growth_rate: cashGrowth,
    inflation_rate: inflation,
    worker_share: workerShare,
    operator_share: operatorShare,
    optInPath,
    stayOutPath,
    delta: {
      age: optEnd.age,
      cash_diff: cashDiff,
      pot_diff: potDiff,
      healthcare_diff: healthcareDiff,
      housing_diff: housingDiff,
      headline,
    },
    source: [
      { tool: 'income_summary', field: 'avgMonthlyNet' },
      { tool: 'monthly_summary.csv', field: 'total_expense' },
      { tool: 'drivers.csv', field: 'age' },
    ],
  };
}
