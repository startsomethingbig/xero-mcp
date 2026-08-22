import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { guidFilter } from "../helpers/xero-where.js";
import { CreditNote } from "xero-node";
import { getClientHeaders } from "../clients/xero-client.js";

async function getCreditNotes(
  contactId: string | undefined,
  page: number,
): Promise<CreditNote[]> {
  await xeroClient.authenticate();

  const response = await xeroClient.accountingApi.getCreditNotes(
    xeroClient.tenantId,
    undefined, // ifModifiedSince
    contactId ? guidFilter("Contact.ContactID", contactId) : undefined, // where
    "UpdatedDateUTC DESC", // order
    page, // page
    undefined, // unitdp
    10, // pageSize
    getClientHeaders(),
  );

  return response.body.creditNotes ?? [];
}

/**
 * List all credit notes from Xero
 */
export async function listXeroCreditNotes(
  page: number = 1,
  contactId?: string,
): Promise<XeroClientResponse<CreditNote[]>> {
  try {
    const creditNotes = await getCreditNotes(contactId, page);

    return {
      result: creditNotes,
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
