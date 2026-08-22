import { XeroClient } from "xero-node";

import type { XeroEnvironment } from "../config/environment.js";
import {
  DraftStateError,
  UnsupportedDraftResourceError,
} from "../drafts/errors.js";
import { getPackageVersion } from "../helpers/get-package-version.js";

export interface XeroApi {
  get<TRecord = unknown>(
    resource: string,
    id: string,
  ): Promise<TRecord | undefined>;
  create<TRecord = unknown>(
    resource: string,
    payload: unknown,
    idempotencyKey: string,
  ): Promise<TRecord>;
  update<TRecord = unknown>(
    resource: string,
    id: string,
    payload: unknown,
  ): Promise<TRecord>;
  delete<TRecord = unknown>(resource: string, id: string): Promise<TRecord>;
}

type XeroSdk = {
  getClientCredentialsToken(): Promise<unknown>;
  setTokenSet(tokenSet: unknown): void;
  accountingApi: object;
};

type TokenSetLike = {
  expires_in?: number;
  expires_at?: number;
};

export interface XeroApiOptions {
  /** Millisecond clock, injectable for tests. */
  now?: () => number;
}

/** Refresh this long before the token actually expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

type ResourceBinding = {
  collection: string;
  getMethod: string;
  createMethod: string;
  updateMethod: string;
  usesUnitdp: boolean;
  summarizesCreate: boolean;
  supportsGenericDelete?: boolean;
};

const RESOURCE_BINDINGS: Record<string, ResourceBinding> = {
  invoice: {
    collection: "invoices",
    getMethod: "getInvoice",
    createMethod: "createInvoices",
    updateMethod: "updateInvoice",
    usesUnitdp: true,
    summarizesCreate: true,
  },
  credit_note: {
    collection: "creditNotes",
    getMethod: "getCreditNote",
    createMethod: "createCreditNotes",
    updateMethod: "updateCreditNote",
    usesUnitdp: true,
    summarizesCreate: true,
  },
  quote: {
    collection: "quotes",
    getMethod: "getQuote",
    createMethod: "createQuotes",
    updateMethod: "updateQuote",
    usesUnitdp: false,
    summarizesCreate: true,
  },
  purchase_order: {
    collection: "purchaseOrders",
    getMethod: "getPurchaseOrder",
    createMethod: "createPurchaseOrders",
    updateMethod: "updatePurchaseOrder",
    usesUnitdp: false,
    summarizesCreate: true,
  },
  manual_journal: {
    collection: "manualJournals",
    getMethod: "getManualJournal",
    createMethod: "createManualJournals",
    updateMethod: "updateManualJournal",
    usesUnitdp: false,
    summarizesCreate: true,
  },
  repeating_invoice: {
    collection: "repeatingInvoices",
    getMethod: "getRepeatingInvoice",
    createMethod: "createRepeatingInvoices",
    updateMethod: "updateRepeatingInvoice",
    usesUnitdp: false,
    summarizesCreate: true,
  },
  receipt: {
    collection: "receipts",
    getMethod: "getReceipt",
    createMethod: "createReceipt",
    updateMethod: "updateReceipt",
    usesUnitdp: true,
    summarizesCreate: false,
    supportsGenericDelete: false,
  },
};

const CLIENT_CREDENTIAL_SCOPES = [
  "accounting.invoices",
  "accounting.payments",
  "accounting.banktransactions",
  "accounting.manualjournals",
  "accounting.reports.aged.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.trialbalance.read",
  "accounting.contacts",
  "accounting.settings",
  "payroll.settings",
  "payroll.employees",
  "payroll.timesheets",
];

export function formatXeroError(error: unknown): string {
  void error;
  return "Xero request failed";
}

function tokenExpiry(tokenSet: unknown, now: number): number {
  const { expires_at, expires_in } = (tokenSet ?? {}) as TokenSetLike;
  if (typeof expires_at === "number" && Number.isFinite(expires_at)) {
    return expires_at * 1_000;
  }
  if (typeof expires_in === "number" && Number.isFinite(expires_in)) {
    return now + expires_in * 1_000;
  }
  return now; // unknown lifetime: never reuse
}

function requireDraftStatus(
  resource: string,
  payload: unknown,
  targetId?: string,
): void {
  const status =
    payload && typeof payload === "object"
      ? (payload as { status?: unknown }).status
      : undefined;
  if (status !== "DRAFT") {
    throw new DraftStateError(
      resource,
      targetId,
      typeof status === "string" ? status : undefined,
    );
  }
}

export function createXeroApi(
  environment: XeroEnvironment,
  sdk: XeroSdk = new XeroClient({
    clientId: environment.clientId,
    clientSecret: environment.clientSecret,
    grantType: "client_credentials",
    scopes: CLIENT_CREDENTIAL_SCOPES,
  }) as unknown as XeroSdk,
  { now = Date.now }: XeroApiOptions = {},
): XeroApi {
  const requestOptions = {
    headers: {
      "user-agent": `xero-mcp-server-${getPackageVersion()}`,
    },
  };

  let tokenExpiresAt = 0;
  let inflight: Promise<void> | undefined;

  /** Fetch a client-credentials token at most once per lifetime, single-flight. */
  async function authenticate(): Promise<void> {
    if (now() < tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) return;
    if (!inflight) {
      inflight = (async () => {
        try {
          const tokenSet = await sdk.getClientCredentialsToken();
          sdk.setTokenSet(tokenSet);
          tokenExpiresAt = tokenExpiry(tokenSet, now());
        } finally {
          inflight = undefined;
        }
      })();
    }
    await inflight;
  }

  function requireSupportedResource(resource: string): ResourceBinding {
    // Plain-object lookup would resolve "constructor" / "__proto__" to truthy
    // prototype members; only own keys are real bindings.
    if (!Object.hasOwn(RESOURCE_BINDINGS, resource)) {
      throw new UnsupportedDraftResourceError(resource);
    }
    return RESOURCE_BINDINGS[resource]!;
  }

  async function callAccounting(
    method: string,
    args: unknown[],
  ): Promise<{ body: Record<string, unknown> }> {
    const accountingApi = sdk.accountingApi as unknown as Record<
      string,
      (...methodArgs: unknown[]) => Promise<{ body: Record<string, unknown> }>
    >;
    return accountingApi[method]!.apply(sdk.accountingApi, args);
  }

  function firstRecord<TRecord>(
    response: { body: Record<string, unknown> },
    binding: ResourceBinding,
  ): TRecord | undefined {
    return (response.body[binding.collection] as TRecord[] | undefined)?.[0];
  }

  return {
    async get<TRecord>(resource: string, id: string) {
      const binding = requireSupportedResource(resource);
      try {
        await authenticate();
        const args = binding.usesUnitdp
          ? [environment.tenantId, id, undefined, requestOptions]
          : [environment.tenantId, id, requestOptions];
        const response = await callAccounting(binding.getMethod, args);
        return firstRecord<TRecord>(response, binding);
      } catch (error: unknown) {
        throw new Error(formatXeroError(error));
      }
    },
    async create<TRecord>(
      resource: string,
      payload: unknown,
      idempotencyKey: string,
    ) {
      const binding = requireSupportedResource(resource);
      requireDraftStatus(resource, payload);
      try {
        await authenticate();
        const prefix: unknown[] = [
          environment.tenantId,
          { [binding.collection]: [payload] },
        ];
        const args = binding.usesUnitdp
          ? binding.summarizesCreate
            ? [...prefix, true, undefined, idempotencyKey, requestOptions]
            : [...prefix, undefined, idempotencyKey, requestOptions]
          : [...prefix, true, idempotencyKey, requestOptions];
        const response = await callAccounting(binding.createMethod, args);
        return firstRecord<TRecord>(response, binding) as TRecord;
      } catch (error: unknown) {
        throw new Error(formatXeroError(error));
      }
    },
    async update<TRecord>(resource: string, id: string, payload: unknown) {
      const binding = requireSupportedResource(resource);
      requireDraftStatus(resource, payload, id);
      try {
        await authenticate();
        const prefix: unknown[] = [
          environment.tenantId,
          id,
          { [binding.collection]: [payload] },
        ];
        const args = binding.usesUnitdp
          ? [...prefix, undefined, undefined, requestOptions]
          : [...prefix, undefined, requestOptions];
        const response = await callAccounting(binding.updateMethod, args);
        return firstRecord<TRecord>(response, binding) as TRecord;
      } catch (error: unknown) {
        throw new Error(formatXeroError(error));
      }
    },
    async delete<TRecord>(resource: string, id: string) {
      const binding = requireSupportedResource(resource);
      if (binding.supportsGenericDelete === false) {
        throw new UnsupportedDraftResourceError(resource);
      }
      try {
        await authenticate();
        const prefix: unknown[] = [
          environment.tenantId,
          id,
          { [binding.collection]: [{ status: "DELETED" }] },
        ];
        const args = binding.usesUnitdp
          ? [...prefix, undefined, undefined, requestOptions]
          : [...prefix, undefined, requestOptions];
        const response = await callAccounting(binding.updateMethod, args);
        return firstRecord<TRecord>(response, binding) as TRecord;
      } catch (error: unknown) {
        throw new Error(formatXeroError(error));
      }
    },
  };
}
