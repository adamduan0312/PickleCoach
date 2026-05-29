# Backend consistency audit (2026-05-21)

This document records a **targeted** consistency pass over the PickleCoach backend: schema ↔ Sequelize ↔ services ↔ controllers ↔ calculations ↔ docs. It is **not** a formal proof that every subsystem is free of drift; several areas are flagged for **follow-up** human review (especially payments and cron concurrency).

---

## Executive summary

| Area | Verdict |
|------|---------|
| **User reliability** | Canonical scoring lives in `reliabilityEngine.js`; persistence keys align with `UserReliability` model. **Fixed**: `paid_reschedules` persistence vs API double-count semantics; **fixed**: legacy `coach_cancels` alias for student rows; **fixed**: migration `down()` referenced undefined `dialect`. |
| **Payment actions** | Model ENUMs extended by migrations (`20260511160000`); `stripe_idempotency_key` added in `20260510120000` — spot-check aligned with `PaymentAction.js`. |
| **Bookings / disputes** | `bookings.status` remains a **multi-concept** ENUM (lifecycle + attendance); mitigated by docs on `attendance_finalized` and dispute `outcome`. |
| **Full duplicate-formula hunt** | Not exhaustive across `paymentService.js` (~1.7k lines). Recommend dedicated payment/refund audit pass. |

---

## 1. Overloaded columns & semantics

### Confirmed / historical

| Location | Issue | Mitigation / recommendation |
|----------|--------|-----------------------------|
| **`user_reliability.coach_cancels` (removed)** | Legacy column stored **student** non-late cancels for `role = student`. | **Resolved** in canonical migration: split into `coach_cancels_non_late_*` vs `student_cancels_non_late_*`. |
| **`bookings.status`** | Single ENUM encodes scheduling lifecycle (`pending`, `confirmed`, …) **and** terminal attendance (`student_no_show`, `coach_no_show`). | **Documented** on model; `attendance_finalized` narrows mutation surface after dispute resolution. Long-term: consider separate `attendance_outcome` or state machine table if product complexity grows. |
| **`paid_reschedules` (API vs DB)** | Public endpoints **recomputed** a different count than was **persisted** (coach: persisted “any paid coach reschedule”; API: penalized + captured payment). Student row always persisted `0` while API showed a count. | **Fixed in this audit**: `reliabilityService.countPaidPenalizedCapturedReschedules` is the single definition; persistence and `GET …/me/reliability` both use the stored row. |

### Legacy API aliases (`attachLegacyReliabilityAliases`)

| Field | Behavior |
|-------|----------|
| `coach_cancels` | For **`role === 'student'`**, now maps to **`student_cancels_non_late_recent`** so legacy clients see the same meaning as pre-canonical `coach_cancels` for students. Coaches unchanged. |

---

## 2. Calculation inconsistencies

| System | Source of truth | Notes |
|--------|-----------------|-------|
| **Reliability score** | `reliabilityEngine.js` (`buildCanonicalReliabilityMetrics`, `calculatePenaltyBreakdown`, `calculateReliabilityScoreFromCanonical`, rounding helpers) | `reliabilityScoring.js` delegates to engine. Constants in `reliabilityConstants.js` + `SCORE_FORMULA_VERSION`. |
| **Reliability paid reschedule count** | `reliabilityService.js` → `countPaidPenalizedCapturedReschedules` | **Removed** duplicate queries from `reliabilityController.js` payload helpers. |
| **Payments / Stripe** | `paymentService.js` + workers | **Canonical pure math** now in `paymentEngine.js` + `paymentConstants.js`; see [`payment-system.md`](payment-system.md) and [`payment-system-audit.md`](payment-system-audit.md). |

---

## 3. Persistence / reconstructibility

| Artifact | Status |
|----------|--------|
| **`score_source === 'computed'`** | `reliability_score` must match `calculateReliabilityScoreFromPersistenceRow(role, row)` (see `reliability-engine.test.mjs`). |
| **`admin_override`** | Periodic jobs use `skipIfAdminOverride: true`; domain events recompute and clear override (by design). |
| **`paid_reschedules`** | Now persisted for **both** roles using the same predicate as previously documented for the API. |

---

## 4. Schema ↔ model ↔ validation

- **`UserReliability`**: Model matches canonical migration column set; automated test `user-reliability-model-persistence-parity.test.mjs` asserts every `flattenCanonicalForPersistence` key exists on the model.
- **`payment_actions`**: Initial migration had a **narrow** `action_type` ENUM; later migration widens it — **must** run migrations in order on fresh DBs.
- **Recommendation**: Add similar “flatten vs model” tests when other tables gain computed denormalized blocks.

---

## 5. Naming inconsistencies

- Prefer **`student_cancels_non_late_*`** naming in code/API over legacy `coach_cancels` for students; aliases exist only for backward compatibility.
- **`refund_cents`** on `disputes` vs `payment_actions`: both use integer cents; comments on `Dispute.js` clarify partial vs full refund flows.

---

## 6. Orphaned / unused fields

- Not scanned mechanically (would need static analysis + production query logs).
- **`UserReliability.badges`**: Still nullable JSON — usage not audited here.

---

## 7. Race conditions / stale derived data

| Pattern | Location | Notes |
|---------|----------|-------|
| Row lock + transaction | `updateUserReliability` | `findOne({ lock: true })` inside transaction reduces stale overwrites. |
| Payment actions | Async workers | **Largest residual risk**: booking/dispute updates vs refund worker ordering — recommend explicit idempotency keys (already on `payment_actions`) and occasional reconciliation job. |
| **Reliability vs disputes** | Multiple writers | Mitigated by locking per `(user_id, role)` row; cross-table ordering still depends on caller discipline. |

---

## 8–9. Invariants & automated tests (implemented / existing)

- **Existing**: `tests/reliability-engine.test.mjs` — round-trip canonical → persist → reconstruct; idempotency of `buildCanonicalReliabilityMetrics`.
- **New**: `tests/user-reliability-model-persistence-parity.test.mjs` — flatten keys ⊆ model attributes.
- **Future**: DB-backed test that samples `user_reliability` rows and asserts `score_source === 'computed'` ⇒ score match (requires test DB + seed).

---

## 10. Confirmed bugs fixed in this audit

1. **`paid_reschedules`**: Persistence and public reliability APIs now share one definition (`countPaidPenalizedCapturedReschedules`).
2. **`attachLegacyReliabilityAliases`**: `coach_cancels` for students now reflects student non-late cancels.
3. **Migration `20260521120000` `down()`**: `dialect` was undefined when dropping MySQL `id` column — **fixed** (`getDialect()`).

---

## Recommended migrations / refactors (not implemented)

1. **`bookings.status`**: Optional normalization to separate lifecycle vs attendance (large product change).
2. **`score_version` default**: DB default remains `1` while app writes `SCORE_FORMULA_VERSION` (e.g. `2`) on recompute — optional migration to bump default for new rows.
3. **Payment domain**: Extract a single `moneyCents` / rounding module and route all refund/charge math through it; add contract tests against Stripe fixture objects.

---

## How to extend this audit

1. Run **`npm test`** (includes new parity test).
2. For SQL drift: compare `information_schema` to `sequelize.define` (script or manual).
3. For formula drift: ripgrep for `* 100`, `toFixed`, `Math.round`, `cents`, `refund` outside `paymentService.js` and reconcile.
