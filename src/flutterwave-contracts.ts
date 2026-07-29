/* oxlint-disable no-restricted-imports */
import * as z from "zod";

const currencySchema = z.string().regex(/^[A-Z]{3}$/, "Currency must be a three-letter ISO code");
const positiveAmountSchema = z.coerce.number().positive();
const optionalDateSchema = z.string().nullable().optional();

export const flutterwaveEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z
    .object({
      status: z.string(),
      message: z.string().optional(),
      data,
    })
    .passthrough();

export const standardCheckoutInputSchema = z
  .object({
    tx_ref: z.string().min(1).max(100),
    amount: positiveAmountSchema,
    currency: currencySchema,
    redirect_url: z.url(),
    customer: z
      .object({
        email: z.email(),
        name: z.string().min(1).optional(),
        phonenumber: z.string().min(1).optional(),
      })
      .passthrough(),
    payment_options: z.string().min(1).optional(),
    payment_plan: z.number().int().positive().optional(),
    subaccounts: z
      .array(
        z
          .object({
            id: z.string().min(1),
            transaction_charge_type: z.enum(["flat", "percentage"]).optional(),
            transaction_charge: z.number().nonnegative().optional(),
          })
          .passthrough(),
      )
      .min(1)
      .optional(),
    customizations: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        logo: z.url().optional(),
      })
      .optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const checkoutDataSchema = z
  .object({
    link: z.url(),
  })
  .passthrough();

export const transactionSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    tx_ref: z.string().min(1),
    flw_ref: z.string().nullable().optional(),
    amount: positiveAmountSchema,
    charged_amount: z.coerce.number().nonnegative().optional(),
    currency: currencySchema,
    status: z.string().min(1),
    payment_type: z.string().nullable().optional(),
    created_at: optionalDateSchema,
    customer: z
      .object({
        id: z.coerce.number().int().optional(),
        email: z.email(),
        name: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    card: z
      .object({
        token: z.string().min(1).optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export const paymentPlanSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    name: z.string().min(1),
    amount: positiveAmountSchema
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    interval: z.string().min(1),
    currency: currencySchema,
    status: z.string().optional(),
    duration: z.coerce.number().int().nonnegative().optional(),
    created_at: optionalDateSchema,
  })
  .passthrough();

export const subscriptionSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    amount: positiveAmountSchema,
    customer: z
      .object({
        email: z.email().optional(),
        customer_email: z.email().optional(),
      })
      .passthrough()
      .optional(),
    plan: z.coerce.number().int().positive().optional(),
    status: z.string().min(1),
    currency: currencySchema.optional(),
    created_at: optionalDateSchema,
  })
  .passthrough();

export const tokenChargeInputSchema = z
  .object({
    token: z.string().min(1),
    currency: currencySchema,
    country: z.string().length(2).toUpperCase().optional(),
    amount: positiveAmountSchema,
    email: z.email(),
    tx_ref: z.string().min(1).max(100),
    narration: z.string().optional(),
  })
  .passthrough();

export const refundSchema = z
  .object({
    id: z.coerce.number().int().positive().optional(),
    transaction_id: z.coerce.number().int().positive().optional(),
    amount_refunded: z.coerce.number().nonnegative().optional(),
    amount: z.coerce.number().nonnegative().optional(),
    status: z.string().min(1),
    created_at: optionalDateSchema,
  })
  .passthrough();

export type StandardCheckoutInput = z.infer<typeof standardCheckoutInputSchema>;
export type FlutterwaveCheckoutData = z.infer<typeof checkoutDataSchema>;
export type FlutterwaveTransactionData = z.infer<typeof transactionSchema>;
export type FlutterwavePaymentPlanData = z.infer<typeof paymentPlanSchema>;
export type FlutterwaveSubscriptionData = z.infer<typeof subscriptionSchema>;
export type FlutterwaveTokenChargeInput = z.infer<typeof tokenChargeInputSchema>;
export type FlutterwaveRefundData = z.infer<typeof refundSchema>;
