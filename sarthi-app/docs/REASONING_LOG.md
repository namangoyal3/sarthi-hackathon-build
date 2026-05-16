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

## Scenario: Scam Shield classifies "APPROVED! Fast cash, 0.8% daily, no NRIC"

| # | Action | Tool | Kind |
|---|--------|------|------|
| 1 | Read the message on device — no upload, no network. | `scam_check()` | tool |
| 2 | Matched 5 patterns: instant cash, no NRIC, daily interest, urgency window, off-app channel. | `scam_check()` | tool |
| 3 | Extracted stated rate "0.8% daily" → annualized APR ≈ 292%. | `scam_check()` | tool |
| 4 | Computed estimated 30-day cost on the message's stated principal. | `scam_check()` | tool |
| 5 | Classified the message as predatory (score ≥ 6). | `scam_check()` | tool |
| 6 | Drafted the regulated counter; handed off to compare_paths() for full comparison. | `compose()` | compose |

### Why this trace matters

This is the part of Sarthi that picks a side. The driver is being preyed on
in a moment of stress; Sarthi reads the message *with the driver*, names the
real cost, and proposes a regulated path. No data is uploaded. The agent is
loyal to the person — not to the lender, and not even to the platform.
