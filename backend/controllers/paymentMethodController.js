import { User } from '../models/index.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logger } from '../config/logger.js';
import * as stripeService from '../services/stripeService.js';

const ensureStripeCustomerForUser = async (user) => {
  if (user.stripe_customer_id) return user.stripe_customer_id;

  const customer = await stripeService.createCustomer({
    email: user.email,
    name: user.full_name,
    metadata: { user_id: String(user.id) },
  });
  await user.update({ stripe_customer_id: customer.id });
  return customer.id;
};

export const listMyPaymentMethods = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'User not found', 404);

    if (!user.stripe_customer_id) {
      return successResponse(res, [], 'Payment methods retrieved successfully');
    }

    const [methods, customer] = await Promise.all([
      stripeService.listCustomerPaymentMethods(user.stripe_customer_id),
      stripeService.getCustomer(user.stripe_customer_id),
    ]);
    const defaultPmId = customer?.invoice_settings?.default_payment_method ?? null;

    const data = (methods.data || []).map((pm) => ({
      id: pm.id,
      type: pm.type,
      brand: pm.card?.brand ?? null,
      last4: pm.card?.last4 ?? null,
      exp_month: pm.card?.exp_month ?? null,
      exp_year: pm.card?.exp_year ?? null,
      is_default: pm.id === defaultPmId,
    }));

    return successResponse(res, data, 'Payment methods retrieved successfully');
  } catch (error) {
    logger.error('List payment methods error:', error);
    return errorResponse(res, 'Failed to retrieve payment methods', 500);
  }
};

export const addMyPaymentMethod = async (req, res) => {
  try {
    const paymentMethodId = req.body?.payment_method_id;
    if (!paymentMethodId || typeof paymentMethodId !== 'string') {
      return errorResponse(res, 'payment_method_id is required', 400);
    }

    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'User not found', 404);

    const customerId = await ensureStripeCustomerForUser(user);
    const attached = await stripeService.attachPaymentMethodToCustomer(paymentMethodId, customerId);
    await stripeService.setCustomerDefaultPaymentMethod(customerId, attached.id);

    return successResponse(
      res,
      {
        id: attached.id,
        type: attached.type,
        brand: attached.card?.brand ?? null,
        last4: attached.card?.last4 ?? null,
        exp_month: attached.card?.exp_month ?? null,
        exp_year: attached.card?.exp_year ?? null,
        is_default: true,
      },
      'Payment method saved successfully',
      201
    );
  } catch (error) {
    logger.error('Add payment method error:', error);
    return errorResponse(res, 'Failed to save payment method', 500);
  }
};

export const setMyDefaultPaymentMethod = async (req, res) => {
  try {
    const paymentMethodId = req.params?.id;
    if (!paymentMethodId) {
      return errorResponse(res, 'Payment method ID is required', 400);
    }

    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'User not found', 404);
    if (!user.stripe_customer_id) {
      return errorResponse(res, 'No Stripe customer found for user', 400);
    }

    const methods = await stripeService.listCustomerPaymentMethods(user.stripe_customer_id);
    const isOwned = (methods.data || []).some((pm) => pm.id === paymentMethodId);
    if (!isOwned) {
      return errorResponse(res, 'Payment method not found for this user', 404);
    }

    await stripeService.setCustomerDefaultPaymentMethod(user.stripe_customer_id, paymentMethodId);
    return successResponse(res, { id: paymentMethodId, is_default: true }, 'Default payment method updated');
  } catch (error) {
    logger.error('Set default payment method error:', error);
    return errorResponse(res, 'Failed to update default payment method', 500);
  }
};

export const deleteMyPaymentMethod = async (req, res) => {
  try {
    const paymentMethodId = req.params?.id;
    if (!paymentMethodId) {
      return errorResponse(res, 'Payment method ID is required', 400);
    }

    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'User not found', 404);
    if (!user.stripe_customer_id) {
      return errorResponse(res, 'No Stripe customer found for user', 400);
    }

    const [methods, customer] = await Promise.all([
      stripeService.listCustomerPaymentMethods(user.stripe_customer_id),
      stripeService.getCustomer(user.stripe_customer_id),
    ]);
    const methodIds = (methods.data || []).map((pm) => pm.id);
    if (!methodIds.includes(paymentMethodId)) {
      return errorResponse(res, 'Payment method not found for this user', 404);
    }

    const defaultPmId = customer?.invoice_settings?.default_payment_method ?? null;
    const isDefault = defaultPmId === paymentMethodId;
    const fallbackPmId = methodIds.find((id) => id !== paymentMethodId) || null;

    if (isDefault && !fallbackPmId) {
      return errorResponse(
        res,
        'Cannot delete the default payment method when no fallback exists',
        400
      );
    }

    if (isDefault && fallbackPmId) {
      await stripeService.setCustomerDefaultPaymentMethod(user.stripe_customer_id, fallbackPmId);
    }

    await stripeService.detachPaymentMethod(paymentMethodId);
    return successResponse(res, { id: paymentMethodId }, 'Payment method deleted successfully');
  } catch (error) {
    logger.error('Delete payment method error:', error);
    return errorResponse(res, 'Failed to delete payment method', 500);
  }
};

