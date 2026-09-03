/**
 * Classify a Connect `transfer.*` webhook against the payment's stored transfer_id.
 *
 * - canonical_unset: payment has no transfer_id yet — first webhook may claim it
 * - canonical: webhook matches payments.transfer_id
 * - duplicate: webhook is a different transfer for the same payment (race)
 *
 * Only canonical / canonical_unset may finalize escrow + booking payout_status.
 * A duplicate success must NOT mark the booking paid if the canonical transfer failed
 * or never confirmed — ops reverses the extra Stripe transfer.
 */

export function classifyConnectTransferWebhook({ paymentTransferId, webhookTransferId } = {}) {
  if (webhookTransferId == null || String(webhookTransferId).trim() === '') {
    return 'invalid';
  }
  if (paymentTransferId == null || String(paymentTransferId).trim() === '') {
    return 'canonical_unset';
  }
  if (String(paymentTransferId) === String(webhookTransferId)) {
    return 'canonical';
  }
  return 'duplicate';
}

/** True when this webhook is allowed to release escrow and set booking payout paid. */
export function shouldFinalizeBookingFromTransferWebhook(classification) {
  return classification === 'canonical' || classification === 'canonical_unset';
}
