import { Dispute, DisputeType } from '../models/index.js';

/**
 * Load dispute type code for resolve validation.
 * This enables Joi conditional rules without trusting client-supplied type values.
 */
export const loadResolveDisputeTypeForValidation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const dispute = await Dispute.findByPk(id, { attributes: ['id', 'dispute_type_id'] });
    if (!dispute) {
      return res.status(404).json({
        success: false,
        error: 'Dispute not found',
        requestId: req.id,
      });
    }

    const disputeType = await DisputeType.findByPk(dispute.dispute_type_id, { attributes: ['code'] });
    const typeCode = disputeType?.code;
    req.body.dispute_type_code = typeCode || null;
    next();
  } catch (error) {
    next(error);
  }
};
