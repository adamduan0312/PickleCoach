import { useState } from 'react';
import { FormField } from '../ui/FormField.jsx';
import { Alert } from '../ui/States.jsx';
import { CharacterCounter } from '../ui/CharacterLimit.jsx';
import { disputesApi } from '../../api/index.js';
import {
  RESOLVE_DECISIONS,
  RESOLVE_FINANCIAL_ACTIONS,
  RESOLVE_OUTCOMES,
  RESOLVE_PENALIZE_ROLES,
  buildResolveRequestBody,
  disputeTypeCode,
  formatResolveApiError,
  resolveConfirmationLines,
  resolveFieldVisibility,
} from '../../domain/adminDisputeResolve.js';

const NOTES_MAX = 1000;

function ChoiceGroup({ name, legend, options, value, onChange, disabled }) {
  return (
    <fieldset className="admin-resolve-fieldset" disabled={disabled}>
      <legend>{legend}</legend>
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

  const form = {
    decision,
    outcome,
    penalize_role: penalizeRole,
    financial_action: financialAction,
    refund_amount: refundAmount,
    resolution_notes: notes,
  };

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

    const summary = resolveConfirmationLines(form, typeCode).join('\n');
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
        Choose decision, {visibility.showOutcome ? 'attendance outcome, ' : ''}
        {visibility.showPenalizeRole ? 'reliability penalty, ' : ''}
        and financial action separately. The backend validates that the combination is allowed.
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
          options={RESOLVE_OUTCOMES}
          value={outcome}
          onChange={setOutcome}
          disabled={busy}
        />
      ) : null}

      {visibility.showPenalizeRole ? (
        <ChoiceGroup
          name="penalize_role"
          legend="Penalize (reliability)"
          options={RESOLVE_PENALIZE_ROLES}
          value={penalizeRole}
          onChange={setPenalizeRole}
          disabled={busy}
        />
      ) : null}

      <ChoiceGroup
        name="financial_action"
        legend="Financial action"
        options={RESOLVE_FINANCIAL_ACTIONS}
        value={financialAction}
        onChange={setFinancialAction}
        disabled={busy}
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
