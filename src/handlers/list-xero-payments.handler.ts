import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Payment } from "xero-node";
import { getClientHeaders } from "../clients/xero-client.js";
import { guidFilter, stringFilter, whereAll } from "../helpers/xero-where.js";

async function getPayments(
  page: number = 1,
  {
    invoiceNumber,
    invoiceId,
    paymentId,
    reference,
  }: {
    invoiceNumber?: string;
    invoiceId?: string;
    paymentId?: string;
    reference?: string;
  },
): Promise<Payment[]> {
  await xeroClient.authenticate();

  const where = whereAll([
    invoiceId ? guidFilter("Invoice.InvoiceID", invoiceId) : undefined,
    invoiceNumber
      ? stringFilter("Invoice.InvoiceNumber", invoiceNumber)
      : undefined,
    paymentId ? guidFilter("PaymentID", paymentId) : undefined,
    reference ? stringFilter("Reference", reference) : undefined,
  ]);

  const response = await xeroClient.accountingApi.getPayments(
    xeroClient.tenantId,
    undefined, // ifModifiedSince
    where,
    "UpdatedDateUTC DESC", // order
    page, // page
    10, // pageSize
    getClientHeaders(), // options
  );

  return response.body.payments ?? [];
}

/**
 * List payments from Xero
 */
export async function listXeroPayments(
  page: number = 1,
  {
    invoiceNumber,
    invoiceId,
    paymentId,
    reference,
  }: {
    invoiceNumber?: string;
    invoiceId?: string;
    paymentId?: string;
    reference?: string;
  },
): Promise<XeroClientResponse<Payment[]>> {
  try {
    const payments = await getPayments(page, {
      invoiceNumber,
      invoiceId,
      paymentId,
      reference,
    });

    return {
      result: payments,
      isError: false,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}
