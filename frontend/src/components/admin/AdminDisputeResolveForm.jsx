import { useEffect, useState } from 'react';
import { FormField } from '../ui/FormField.jsx';
import { Alert } from '../ui/States.jsx';
import { CharacterCounter } from '../ui/CharacterLimit.jsx';
import { disputesApi } from '../../api/index.js';
import {
  RESOLVE_DECISIONS,
  attendanceOutcomeOptions,
  buildResolveRequestBody,
  disputeTypeCode,
  financialActionOptions,
  formatResolveApiError,
  penalizeRoleOptions,
  resolveConfirmationLines,
  resolveFieldVisibility,
  resolveFormHint,
} from '../../domain/adminDisputeResolve.js';
import { previewFinancialAllocation } from '../../domain/bookingSettlementDisplay.js';
import { formatMoney } from '../../utils/format.js';

const NOTES_MAX = 1000;

function ChoiceGroup({ name, legend, options, value, onChange, disabled, hint }) {
  return (
    <fieldset className="admin-resolve-fieldset" disabled={disabled}>
      <legend>{legend}</legend>
      {hint ? <p className="small muted" style={{ margin: '0 0 0.45rem' }}>{hint}</p> : null}
      <div className="stack" style={{ gap: '0.45rem' }}>
        {options.map((opt) => (
          <label key={opt.value} className="admin-resolve-choice">
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function keepIfAllowed(current, options) {
  if (!current) return current;
  return options.some((o) => o.value === current) ? current : '';
}

/**
 * @param {{
 *   dispute: object,
 *   onResolved: (result: { dispute: object, warnings?: object[] }) => void,
 * }} props
 */
export function AdminDisputeResolveForm({ dispute, onResolved }) {
  const typeCode = disputeTypeCode(dispute);
  const visibility = resolveFieldVisibility(typeCode);

  const [decision, setDecision] = useState('');
  const [outcome, setOutcome] = useState('');
  const [penalizeRole, setPenalizeRole] = useState('');
  const [financialAction, setFinancialAction] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [apiError, setApiError] = useState(null);
  const [warnings, setWarnings] = useState(null);

  const outcomeOptions = attendanceOutcomeOptions(typeCode, decision);
  const penalizeOptions = penalizeRoleOptions(decision);
  const moneyOptions = financialActionOptions({
    disputeTypeCode: typeCode,
    decision,
    outcome,
  });

  // Drop selections that became invalid when decision / outcome filters change.
  useEffect(() => {
    setOutcome((prev) => keepIfAllowed(prev, attendanceOutcomeOptions(typeCode, decision)));
  }, [decision, typeCode]);

  useEffect(() => {
    setPenalizeRole((prev) => keepIfAllowed(prev, penalizeRoleOptions(decision)));
  }, [decision]);

  useEffect(() => {
    setFinancialAction((prev) => keepIfAllowed(prev, financialActionOptions({
      disputeTypeCode: typeCode,
      decision,
      outcome,
    })));
  }, [decision, outcome, typeCode]);

  const form = {
    decision,
    outcome,
    penalize_role: penalizeRole,
    financial_action: financialAction,
    refund_amount: refundAmount,
    resolution_notes: notes,
  };

  const capturedAmount =
    dispute?.booking?.price
    ?? dispute?.payment?.total_charge_to_student
    ?? dispute?.booking?.payment?.total_charge_to_student
    ?? null;
  const moneyPreview = previewFinancialAllocation({
    capturedAmount,
    financialAction,
    refundAmount,
  });

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    setApiError(null);
    setWarnings(null);

    const built = buildResolveRequestBody(form, typeCode);
    if (!built.ok) {
      setLocalError(built.message);
      return;
    }

    const summary = resolveConfirmationLines(form, typeCode, { capturedAmount }).join('\n');
    const ok = window.confirm(
      `You're about to resolve this dispute.\n\n${summary}\n\nThis action may affect payment, payout, and attendance finalization.`,
    );
    if (!ok) return;

    setBusy(true);
    try {
      const res = await disputesApi.resolve(dispute.id, built.body);
      const payload = res.data || {};
      const resolvedDispute = payload.dispute || payload;
      const warn = Array.isArray(payload.warnings) ? payload.warnings : null;
      if (warn?.length) setWarnings(warn);
      onResolved?.({ dispute: resolvedDispute, warnings: warn, raw: payload });
    } catch (err) {
      setApiError(formatResolveApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack admin-resolve-form" onSubmit={handleSubmit}>
      <p className="small muted" style={{ margin: 0 }}>
        {resolveFormHint(typeCode)}
      </p>

      <ChoiceGroup
        name="decision"
        legend="Decision"
        options={RESOLVE_DECISIONS}
        value={decision}
        onChange={setDecision}
        disabled={busy}
      />

      {visibility.showOutcome ? (
        <ChoiceGroup
          name="outcome"
          legend="Attendance outcome"
          options={outcomeOptions}
          value={outcome}
          onChange={setOutcome}
          disabled={busy}
          hint={
            decision === 'rejected'
              ? 'Use Neither / lesson occurred when the lesson happened and neither party should be marked as a no-show. Or pick the contradicting no-show if the other party was actually absent.'
              : 'Sets booking status and reliability for the at-fault party.'
          }
        />
      ) : null}

      {visibility.showPenalizeRole ? (
        <ChoiceGroup
          name="penalize_role"
          legend="Penalize (reliability)"
          options={penalizeOptions}
          value={penalizeRole}
          onChange={setPenalizeRole}
          disabled={busy}
          hint={
            decision === 'upheld'
              ? 'Uphold must target coach or student — Neither is not allowed.'
              : decision === 'rejected'
                ? 'Rejected behavior claims use Neither.'
                : null
          }
        />
      ) : null}

      <ChoiceGroup
        name="financial_action"
        legend="Financial action"
        options={moneyOptions}
        value={financialAction}
        onChange={setFinancialAction}
        disabled={busy}
        hint={
          outcome === 'coach_no_show'
            ? 'Coach no-show requires a full or partial refund.'
            : outcome === 'student_no_show'
              ? 'Student no-show requires no financial action.'
              : outcome === 'lesson_occurred'
                ? 'Lesson occurred: no refund; booking stays Completed.'
                : decision === 'rejected' && (visibility.showPenalizeRole || typeCode === 'other')
                  ? 'Rejected decisions require no financial action.'
                  : null
        }
      />

      {financialAction === 'refund_student_partial' ? (
        <FormField
          label="Partial refund amount (USD)"
          name="refund_amount"
          type="number"
          value={refundAmount}
          onChange={(e) => setRefundAmount(e.target.value)}
          required
          hint="Required for partial refunds. Must not exceed remaining charge balance."
          disabled={busy}
          min="0.01"
          step="0.01"
        />
      ) : null}

      {moneyPreview ? (
        <Alert tone="info">
          <strong>Financial allocation preview</strong>
          <dl className="booking-detail-facts" style={{ marginTop: 8, marginBottom: 0 }}>
            <div>
              <dt>Student refund</dt>
              <dd>{formatMoney(moneyPreview.studentRefund)}</dd>
            </div>
            <div>
              <dt>Amount remaining</dt>
              <dd>{formatMoney(moneyPreview.remaining)}</dd>
            </div>
            <div>
              <dt>Platform fee</dt>
              <dd>{formatMoney(moneyPreview.platformFee)}</dd>
            </div>
            <div>
              <dt>Coach payout</dt>
              <dd>{formatMoney(moneyPreview.coachPayout)}</dd>
            </div>
          </dl>
          {financialAction === 'refund_student_partial' ? (
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              A partial refund returns only the specified amount to the student. The remaining
              captured amount is split between the platform fee and coach payout. It is not
              automatically refunded to the student again.
            </p>
          ) : null}
        </Alert>
      ) : null}

      <FormField label="Resolution notes" name="resolution_notes" required>
        <>
          <textarea
            id="resolution_notes"
            name="resolution_notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={NOTES_MAX}
            required
            disabled={busy}
            placeholder="Summarize the evidence and why this resolution applies."
          />
          <CharacterCounter value={notes} max={NOTES_MAX} />
        </>
      </FormField>

      {decision && financialAction ? (
        <div className="card stack admin-resolve-summary">
          <strong>Review before resolving</strong>
          <ul className="admin-resolve-summary-list">
            {resolveConfirmationLines(form, typeCode).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="small muted" style={{ margin: 0 }}>
            This may move money and finalizes attendance for the booking.
          </p>
        </div>
      ) : null}

      {localError ? <Alert tone="error">{localError}</Alert> : null}
      {apiError ? <Alert tone="error">{apiError}</Alert> : null}
      {warnings?.length ? (
        <Alert tone="warning">
          Resolved with warnings:{' '}
          {warnings.map((w) => w.code || w.message).filter(Boolean).join(', ')}
        </Alert>
      ) : null}

      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Resolving…' : 'Resolve dispute'}
      </button>
    </form>
  );
}
