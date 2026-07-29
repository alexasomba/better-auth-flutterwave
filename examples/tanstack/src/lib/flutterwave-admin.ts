import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import * as z from "zod/v4";
import { auth } from "@/lib/auth";

const verifyCallbackInputSchema = z
  .object({
    txRef: z.string().min(1).optional(),
    transactionId: z.coerce.number().int().positive().optional(),
  })
  .refine((input) => input.txRef !== undefined || input.transactionId !== undefined);

export interface VerifyCallbackResult {
  status: string;
  txRef: string;
  data: { status: string };
}

export const verifyFlutterwaveCallbackServerFn = createServerFn({ method: "POST" })
  .inputValidator(verifyCallbackInputSchema)
  .handler(async ({ data }) => {
    const result = await auth.api.verifyFlutterwaveTransaction({
      body: {
        txRef: data.transactionId === undefined ? data.txRef : undefined,
        transactionId: data.transactionId,
      },
      headers: getRequestHeaders(),
    });
    return {
      status: result.status,
      txRef: result.txRef,
      data: { status: result.data.status },
    } satisfies VerifyCallbackResult;
  });
