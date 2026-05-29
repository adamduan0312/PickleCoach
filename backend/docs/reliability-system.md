# Reliability scoring system

This document describes how marketplace **reliability scores** are computed, persisted in `user_reliability`, and explained in admin APIs.

## Roles and rows

- One row per `(user_id, role)` where `role` is `coach` or `student`.
- Coach metrics aggregate only bookings where the user is `coach_id`.
- Student metrics aggregate only bookings where the user is `primary_student_id`.
- Admins are excluded from automatic recomputation.

## Time model: recent vs decayed

- **Rolling window** (default 90 days, `RELIABILITY_WINDOW_DAYS`): events on or after the window start count as **recent** with weight **1**.
- Events **before** the window start contribute **decayed** weight \(\exp(-\lambda \cdot \text{ageDays})\) with \(\lambda\) from `RELIABILITY_DECAY_LAMBDA` (default `0.03`).
- **Total** for each penalty category = `recent` (integer count) + `decayed` (fractional sum of weights).

Booking baseline (denominator input):

- `booking_baseline_recent` = sum of recent weights (1 per in-window booking scheduled time).
- `booking_baseline_decayed` = sum of decay weights for older bookings.
- `booking_baseline_total` = `recent + decayed`.

## Denominator and smoothing

\[
\text{denominator} = \max(1,\ \text{booking\_baseline\_total} + K)
\]

`K` is `smoothing_k` (default `5`, `RELIABILITY_SMOOTHING_K`), stored on each row so historical rows remain reconstructible if defaults change.

## Score formula

Start at **100**, subtract weighted ratios `(penalty_total / denominator) * weight`, clamp to `[0, 100]`.

Weights differ by role; see `reliabilityEngine.js` → `calculatePenaltyBreakdown`.

## Persistence and reconstructibility

`updateUserReliability` writes:

- All `*_recent`, `*_decayed`, `*_total` penalty buckets used in scoring.
- `paid_reschedules` is **informational** (paid + penalized + `affects_reliability` reschedules whose linked payment is **captured** or **partially_refunded**; persisted for both coach and student rows from the same query the API reads) and is **not** a scoring input.
- `smoothing_k`, `decay_lambda`, `scoring_window_days`, `last_recomputed_at`, `score_version`, `score_source`.

When `score_source === 'computed'`, `reliability_score` must equal `calculateReliabilityScoreFromPersistenceRow(role, row)` after the same fixed-precision rounding rules (see tests).

## Fixed precision and DECIMAL

- Fractional metrics (`*_decayed`, `*_total`, `booking_baseline_decayed`, `booking_baseline_total`, `smoothing_k`, `decay_lambda`) are rounded to **`RELIABILITY_METRIC_DECIMAL_PLACES` (6)** at canonical boundaries via `roundReliabilityMetric` in `reliabilityEngine.js`.
- **`reliability_score`** is rounded to **2** decimal places (`roundReliabilityScoreValue`), matching `DECIMAL(5,2)`.
- MySQL returns `DECIMAL` as strings in some clients; Sequelize parses them to numbers — `persistenceRowToCanonical` + `buildCanonicalReliabilityMetrics` re-apply the same rounding so JSON/API drift does not break reconstructibility.

## `score_version` and formula history

- **`SCORE_FORMULA_VERSION`** in `reliabilityConstants.js` must be **incremented whenever** weights, decay semantics, smoothing, or window rules change.
- Each recompute persists `score_version` on the row. Rows with an older version are still interpretable using the **stored** `smoothing_k`, `decay_lambda`, and `scoring_window_days` plus `reliabilityEngine` code at that git tag.
- **`getScoringFormulaSnapshot()`** returns the active global formula inputs for audits (optionally log alongside reliability changes).

## Admin override vs periodic jobs

- **`PUT /api/admin/users/:id/reliability`** sets `score_source = admin_override` (audit-logged).
- **Domain-driven** calls (`updateUserReliability(userId, role)` with default options) **always recompute** from source and set `score_source = computed` — this clears an override when real marketplace events occur (intentional).
- **Periodic** recomputes (`recalculateReliability`, `monthlyCoachReliabilityReset`) call `updateUserReliability(..., { skipIfAdminOverride: true })` so a support override is **not** overwritten by the batch worker.

## Concurrency

- `updateUserReliability` runs inside a **DB transaction** with **`SELECT … FOR UPDATE`** (`lock: true`) on the existing `user_reliability` row when present, then updates or creates the row. This reduces lost updates when a webhook and a worker overlap; it does **not** serialize against booking/dispute writes on other tables — those flows should complete their booking/cancel rows before calling `updateUserReliability` (existing ordering).

## Idempotency (same source snapshot)

- For a **fixed** source database state and the same recomputation `now`, aggregation is deterministic; canonical rounding makes persisted floats stable across repeated runs.
- **Clock skew**: decay uses wall-clock `now`, so two runs at different times can differ slightly for edge-of-window events — expected, not cumulative corruption.

## Legacy API aliases

`attachLegacyReliabilityAliases` adds older field names (`total_bookings`, `reschedules`, `late_cancels`, …) mapped from the canonical columns for backward-compatible JSON.

## Operational note

After deploying the canonical-metrics migration, run once:

```bash
npm run reliability:recompute:all
```

so decayed fractions are recomputed from source (the migration backfills decayed dimensions as `0` from legacy integers).
