# Sarthi — Sample Reasoning Log

Deliverable (c). This is a **real** trace captured from the running prototype,
not a script. Every figure is produced by a typed tool over a CSV row; the
driver opens it from the hero card. Tools are shown as `tool_name()`.

---

## Scenario: Siti Rahman logs a S$400 bike repair

Persona: firefighter · Singapore · age 45 · 2 dependents · thin-file.
Goals tracked: Emergency cash buffer, Family health insurance fund.

| # | Action | Tool | Kind |
|---|--------|------|------|
| 1 | Checked the request is in scope (financial wellness for this driver) and redacted identifiers before reasoning. | `input_guard()` | guard |
| 2 | Shock signal received (bike repair, S$400). Re-running the state machine over fresh inputs. | `supervisor.plan()` | plan |
| 3 | Read the latest month (2026-05): S$2,952 spend, top category HOUSING S$631. | `expense_breakdown()` | tool |
| 4 | Computed average net income S$3,055/mo across the last 3 months; volatility S$1,893. | `income_summary()` | tool |
| 5 | Cash runway: 133 days at a stressed daily burn of S$24.8 (income stressed to 55%), down from 149 before the shock. | `forecast_cashflow()` | tool |
| 6 | Emergency cash buffer: 0% funded, weekly need S$0 → On track. | `goal_tracker()` | tool |
| 7 | Family health insurance fund: 15% funded, weekly need S$26.7 → On track. | `goal_tracker()` | tool |
| 8 | Compared three ways to cover the S$400 gap; the FlexiLoan bridge had the lowest total cost (first draw 60 days interest-free). | `plan_actions()` | tool |
| 9 | Matched the need to GXS FlexiLoan. | `match_product()` | tool |
| 10 | Notional surplus this week S$89. Allocated across GXS Bank / Boost Pocket / Invest by firefighter risk profile. | `allocate_surplus()` | tool |
| 11 | Goal progress unlocked partner benefit(s): Family health insurance, GXS Boost Pocket tier. | `check_unlocks()` | tool |
| 12 | Composed a red hero and a bridge-first plan. Verified every figure traces to a tool result and the reply stayed in scope. | `output_guard()` | guard |
| 13 | Emitted the dashboard state and this reasoning trace. | `compose()` | compose |

### Why the log matters

The log is what separates Sarthi from a black-box recommendation. The driver —
and the judges — can see that the agent **prioritised**: it absorbed the shock
against the runway and a FlexiLoan bridge rather than raiding the health fund,
and it never invented a number. The agent has values, not just calculations.

> Reproduce live: run the app, pick Siti, confirm goals, tap the **+** button,
> choose "S$400 bike repair", then tap **See how Sarthi reasoned →**.

---

## Scenario: the Visible Committee plans Siti's next 7 days

| # | Action | Tool | Kind |
|---|--------|------|------|
| 1 | Pulled top expected_net_per_hour cells from `zone_demand_grid.csv`. | `committee_plan()` | tool |
| 2 | Conservative Earner proposed 24h, daytime peaks only — buffer first. | `committee_plan()` | tool |
| 3 | Goal Chaser proposed 38h including two late-night surges — accelerate insurance funding. | `committee_plan()` | tool |
| 4 | Fatigue & Safety Auditor capped at 30h and vetoed driving past 23:00. | `committee_plan()` | tool |
| 5 | Round 2 negotiation: Chaser conceded; one early-evening surge replaces a late-night surge. | `committee_plan()` | tool |
| 6 | Consensus: 30h across daytime peaks + one early-evening surge; rest day reserved. | `committee_plan()` | tool |
| 7 | Verified every figure traces to a CSV row or a stated assumption. | `output_guard()` | guard |

### Why this trace matters

This is the part of Sarthi where heterogeneous voices argue with values, not
just calculate. The driver sees the disagreement, then sees the converged
plan with the rejected alternatives explicitly listed. That is the difference
between "an AI that recommends" and "a council that decides with you."
