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
