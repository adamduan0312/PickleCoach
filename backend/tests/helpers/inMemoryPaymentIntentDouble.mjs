/**
 * In-memory Stripe PaymentIntent + Customer double for HTTP integration tests.
 * Simulates authorize-first: create with capture_method=manual → requires_capture
 * (client authorization step is skipped / treated as already done).
 */
export function createInMemoryPaymentIntentDouble() {
  /** @type {Map<string, object>} */
  const intents = new Map();
  let piSeq = 1;
  let custSeq = 1;
  let chargeSeq = 1;
  // Globally unique across parallel suites that share MySQL.
  const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  const buildPi = (row) => ({
    id: row.id,
    status: row.status,
    amount: row.amountCents,
    amount_capturable: row.status === 'requires_capture' ? row.amountCents : 0,
    currency: row.currency,
    customer: row.customerId,
    metadata: { ...row.metadata },
    client_secret: `${row.id}_secret_test`,
    latest_charge: row.chargeId,
    charges: row.chargeId ? { data: [{ id: row.chargeId }] } : { data: [] },
    capture_method: row.captureMethod,
  });

  const api = {
    intents,
    /** @type {number} */ captureCallCount: 0,
    /** @type {number} */ cancelCallCount: 0,
    /** @type {number} */ retrieveChargeCallCount: 0,
    /** @type {number} */ createRefundCallCount: 0,
    /** When set, next capturePaymentIntent throws this Error (then clears). */
    failNextCapture: null,
    /** When set, next createRefund throws this Error (then clears). */
    failNextCreateRefund: null,
    /** @type {Map<string, string>} */ refundIdByIdempotencyKey: new Map(),
    refundSeq: 1,

    async createCustomer({ email, name, metadata = {} } = {}) {
      return {
        id: `cus_test_${runId}_${custSeq++}`,
        email,
        name,
        metadata: { ...metadata },
      };
    },

    /**
     * Mirrors stripeService.createPaymentIntent signature.
     * @param {number} amountDollars
     */
    async createPaymentIntent(amountDollars, currency = 'usd', customerId = null, metadata = {}, options = {}) {
      const id = `pi_test_${runId}_${piSeq++}`;
      const amountCents = Math.round(Number(amountDollars) * 100);
      const captureMethod = options.captureMethod || 'automatic';
      // Integration double: manual capture intents are already authorized (requires_capture).
      const status = captureMethod === 'manual' ? 'requires_capture' : 'requires_payment_method';
      const row = {
        id,
        amountCents,
        currency: String(currency || 'usd').toLowerCase(),
        customerId,
        metadata: { ...(metadata || {}) },
        captureMethod,
        status,
        chargeId: null,
        captureCalls: 0,
        cancelCalls: 0,
        amountRefundedCents: 0,
        refunds: [],
      };
      intents.set(id, row);
      return buildPi(row);
    },

    async getPaymentIntent(paymentIntentId) {
      const row = intents.get(String(paymentIntentId));
      if (!row) throw new Error(`unknown payment intent ${paymentIntentId}`);
      return buildPi(row);
    },

    async capturePaymentIntent(paymentIntentId) {
      const row = intents.get(String(paymentIntentId));
      if (!row) throw new Error(`unknown payment intent ${paymentIntentId}`);
      api.captureCallCount += 1;
      row.captureCalls += 1;
      if (api.failNextCapture) {
        const err = api.failNextCapture;
        api.failNextCapture = null;
        throw err instanceof Error ? err : new Error(String(err));
      }
      if (row.status === 'succeeded') return buildPi(row);
      if (row.status !== 'requires_capture') {
        throw new Error(`PaymentIntent ${paymentIntentId} is not capturable (status: ${row.status})`);
      }
      row.chargeId = `ch_test_${runId}_${chargeSeq++}`;
      row.status = 'succeeded';
      return buildPi(row);
    },

    async cancelPaymentIntent(paymentIntentId) {
      const row = intents.get(String(paymentIntentId));
      if (!row) throw new Error(`unknown payment intent ${paymentIntentId}`);
      api.cancelCallCount += 1;
      row.cancelCalls += 1;
      if (row.status === 'canceled') return buildPi(row);
      row.status = 'canceled';
      return buildPi(row);
    },

    async retrieveCharge(chargeId) {
      api.retrieveChargeCallCount += 1;
      const row = [...intents.values()].find((r) => r.chargeId === String(chargeId));
      if (!row) throw new Error(`unknown charge ${chargeId}`);
      return {
        id: row.chargeId,
        amount: row.amountCents,
        amount_refunded: row.amountRefundedCents || 0,
        currency: row.currency,
        payment_intent: row.id,
        status: 'succeeded',
        refunds: { data: row.refunds || [] },
      };
    },

    async createRefund(
      chargeId,
      { amountCents = null, reason: _reason = null, idempotencyKey = null, metadata = null } = {},
    ) {
      api.createRefundCallCount += 1;
      if (api.failNextCreateRefund) {
        const err = api.failNextCreateRefund;
        api.failNextCreateRefund = null;
        throw err instanceof Error ? err : new Error(String(err));
      }
      const row = [...intents.values()].find((r) => r.chargeId === String(chargeId));
      if (!row) throw new Error(`unknown charge ${chargeId}`);
      if (idempotencyKey && api.refundIdByIdempotencyKey.has(String(idempotencyKey))) {
        const rid = api.refundIdByIdempotencyKey.get(String(idempotencyKey));
        const existing = (row.refunds || []).find((x) => x.id === rid);
        if (!existing) throw new Error(`missing refund for idempotency replay ${rid}`);
        return { ...existing, metadata: { ...existing.metadata } };
      }
      const remaining = Math.max(0, row.amountCents - (row.amountRefundedCents || 0));
      const amt = amountCents != null ? Math.round(amountCents) : remaining;
      if (amt < 1 || amt > remaining) {
        throw new Error(`invalid refund amount ${amt} remaining ${remaining}`);
      }
      const id = `re_test_${runId}_${api.refundSeq++}`;
      const refund = {
        id,
        amount: amt,
        metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {},
      };
      row.amountRefundedCents = (row.amountRefundedCents || 0) + amt;
      row.refunds = [...(row.refunds || []), refund];
      if (idempotencyKey) api.refundIdByIdempotencyKey.set(String(idempotencyKey), id);
      return refund;
    },

    /**
     * Integration only: treat request body as a JSON Stripe Event (no real HMAC).
     * Requires a non-empty stripe-signature header so unsigned requests still fail.
     */
    verifyWebhookSignature(payload, signature) {
      if (!signature) {
        throw new Error('No stripe-signature header value was provided.');
      }
      const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload ?? '');
      const event = JSON.parse(raw);
      if (!event?.id || !event?.type) {
        throw new Error('Invalid test webhook event payload');
      }
      return event;
    },
  };
  return api;
}
