/**
 * Stateful in-memory Stripe charge + refunds for integration tests.
 * Works with `setStripeTestDouble` in `stripeService.js`.
 */
export const createInMemoryStripeChargeDouble = ({ chargeId, paymentIntentId, amountCents }) => {
  /** @type {Map<string, string>} idempotency key → refund id (Stripe replay semantics) */
  const refundIdByIdempotencyKey = new Map();

  const state = {
    chargeId,
    paymentIntentId,
    amountCents,
    amountRefunded: 0,
    refunds: [],
    nextRefundSeq: 1,
  };

  const buildChargePayload = () => ({
    id: chargeId,
    amount: state.amountCents,
    amount_refunded: state.amountRefunded,
    refunds: { data: state.refunds.map((r) => ({ ...r })) },
  });

  return {
    state,

    async retrieveCharge(id) {
      if (id !== state.chargeId) throw new Error(`unknown charge ${id}`);
      return buildChargePayload();
    },

    async getPaymentIntent(id) {
      if (id !== state.paymentIntentId) throw new Error(`unknown pi ${id}`);
      return {
        id: state.paymentIntentId,
        status: 'succeeded',
        latest_charge: state.chargeId,
      };
    },

    async createRefund(
      cid,
      { amountCents = null, reason: _reason = null, idempotencyKey = null, metadata = null } = {}
    ) {
      if (cid !== state.chargeId) throw new Error(`unknown charge ${cid}`);
      if (idempotencyKey && refundIdByIdempotencyKey.has(String(idempotencyKey))) {
        const rid = refundIdByIdempotencyKey.get(String(idempotencyKey));
        const existing = state.refunds.find((x) => x.id === rid);
        if (!existing) throw new Error(`missing refund for idempotency replay ${rid}`);
        return { ...existing, metadata: { ...existing.metadata } };
      }

      const remaining = Math.max(0, state.amountCents - state.amountRefunded);
      const amt = amountCents != null ? Math.round(amountCents) : remaining;
      if (amt < 1 || amt > remaining) {
        throw new Error(`invalid refund amount ${amt} remaining ${remaining}`);
      }
      const id = `re_test_${state.nextRefundSeq++}`;
      const row = {
        id,
        amount: amt,
        metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {},
      };
      state.amountRefunded += amt;
      state.refunds.push(row);
      if (idempotencyKey) refundIdByIdempotencyKey.set(String(idempotencyKey), id);
      return row;
    },

    async listRefundsForCharge(cid, _opts = {}) {
      if (cid !== state.chargeId) return [];
      return state.refunds.map((r) => ({ ...r, metadata: { ...r.metadata } }));
    },

    async retrieveRefund(rid) {
      const r = state.refunds.find((x) => x.id === rid);
      if (!r) throw new Error(`unknown refund ${rid}`);
      return { ...r };
    },
  };
};
