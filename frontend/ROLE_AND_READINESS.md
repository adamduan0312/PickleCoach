# Roles vs coach readiness (frontend contract)

Use **`src/domain/userReadiness.js`** and **`src/hooks/useCoachReadiness.js`** everywhere instead of treating `user.roles` as feature flags.

**Backend alignment:** Profile/session **`roles`** are **effective** after admin **role governance** (see `API_ENDPOINTS.md`: `role_state`, `PUT /api/users/:id`). Use **`role_state.locked`** and **`role_state.allowed_roles`** to disable self-service “add coach” UI when the server will return **403**.

## Domain rules

| Concept | Meaning |
|--------|---------|
| **`user.roles`** (from **`GET /api/auth/profile`** / login **`user`**) | **Effective** permissions (after admin governance filter when locked). For “intent only” vs profile, still use **`coachProfile`** + Stripe in **`userReadiness`**. |
| **Student** | `student` role is sufficient for student flows (no separate profile). |
| **Coach UI** | Never gate the full coach dashboard on `roles.includes('coach')` alone. |
| **Role removed** | If `coach` is not in `roles`, coach shell is **`hidden`** immediately — even if `coachProfile` / Stripe data still exist (admin revoked access). |

## Derived selectors

- **`hasCoachRole(roles)`** — intent only.
- **`hasCoachProfile(user)`** — non-deleted `coachProfile`.
- **`hasStripeAccountId(profile)`** — `stripe_account_id` present.
- **`isStripeConnectOnboardingComplete(status)`** — optional; uses API fields like `payouts_enabled` + `details_submitted`.
- **`isCoachReady(user, stripeConnectStatus?)`** — role + profile + Stripe account id; if `stripeConnectStatus` object is passed, also requires Connect onboarding complete.
- **`getCoachUiPhase(user, stripeConnectStatus?)`** — `hidden` | `start_setup` | `connect_stripe` | `complete_stripe` | `ready`.
- **`computeCoachReadiness(user, stripeConnectStatus?)`** — single object for components.

## UI mapping (recommended)

| Phase | UX |
|-------|-----|
| `hidden` | No coach nav / routes (or redirect); optionally explain admin removed access. |
| `start_setup` | “Become a coach” / create coach profile (`POST /api/coaches/profile`). |
| `connect_stripe` | “Connect Stripe” (`POST /api/coaches/me/stripe-connect/onboard`). |
| `complete_stripe` | Resume Stripe Connect onboarding. |
| `ready` | Full coach dashboard. |

## Marketplace bookability (separate from UI readiness)

`isCoachReady` / `coachUiPhase === 'ready'` means the coach can use the **dashboard** (role + profile + Stripe account started). It does **not** mean they appear in student search.

**Marketplace listing** (`listed`) is a separate checklist from:

```
GET /api/coaches/me/marketplace-status
```

```json
{
  "listed": false,
  "missing": ["availability", "stripe"],
  "steps": {
    "profile": true,
    "stripe": false,
    "lesson": true,
    "court": true,
    "availability": false
  }
}
```

Discovery (`GET /api/coaches`, public `GET /api/lessons`) only returns coaches / lessons when the coach is marketplace-eligible, using **database fields only** (including `coach_profiles.stripe_ready`). After Stripe onboarding, call Connect **status** (or wait for `account.updated`) so `stripe_ready` flips; then ensure lesson + court + availability exist.

**Do not** wire booking intent to this checklist — transactional validation stays separate (lesson/court/slot/stripe_ready facts as needed). **`GET /api/coaches/:id`** stays looser for profile deep links. **Public lesson pages** (`GET /api/lessons` and `GET /api/lessons/:id`) only expose marketplace-eligible coaches — owner/admin can still load their own lessons regardless.

Recommended coach setup UX order: profile → lessons → courts → availability → finish Stripe. Stripe can be last, but they stay **hidden from discovery** until it is complete (`stripe_ready`).

## Anti-patterns

```js
// ❌ Do not
if (user.roles.includes('coach')) showCoachDashboard();
```

```js
// ✅ Do
const { coachUiPhase, isCoachReady } = computeCoachReadiness(user, stripeStatus);
```

Backend auth remains authoritative; the frontend avoids broken or over-privileged UI.
