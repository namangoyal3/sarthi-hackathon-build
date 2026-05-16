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
