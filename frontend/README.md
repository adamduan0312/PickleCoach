# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Roles vs coach readiness

PickleCoach separates **`user.roles`** (permissions) from **coach onboarding** (profile + Stripe). See **[ROLE_AND_READINESS.md](./ROLE_AND_READINESS.md)**. Use **`src/domain/userReadiness.js`** and **`src/hooks/useCoachReadiness.js`** instead of branching on `roles.includes('coach')` alone for coach UI.

```bash
npm test
```

## Stripe authorize test page (dev)

After `POST /api/booking-intents` returns a `client_secret`, authorize the PaymentIntent with Stripe.js (do not rely on the Dashboard to complete this step).

1. `npm run dev` in `frontend/`
2. Open [http://localhost:5173/stripe-authorize-test.html](http://localhost:5173/stripe-authorize-test.html)
3. Paste your **Test Mode publishable key** (`pk_test_…` from Stripe Dashboard → Developers → API keys)
4. Paste the `client_secret` from the booking-intent response
5. Mount → “ready” means the card form is shown; enter a card, then Authorize
   - Success: `4242 4242 4242 4242` → PaymentIntent **`requires_capture`**
   - Decline: `4000 0000 0000 0002` → Stripe error; PI stays not `requires_capture`
6. New intent: paste the new `client_secret` and Mount again (or Reset first)
7. Continue backend flow: `POST /api/bookings/confirm` with `{ "payment_intent_id": "pi_…" }`

Optional query params: `?client_secret=…&pk=…`

This page is a minimal stand-in for future React checkout (`client_secret` → Payment Element → `confirmPayment`).
