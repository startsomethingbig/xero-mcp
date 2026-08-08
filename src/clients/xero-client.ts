import { Organisation, XeroClient } from "xero-node";

import { getPackageVersion } from "../helpers/get-package-version.js";
import { formatXeroError } from "../xero/client.js";

const LEGACY_SCOPES = [
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

/**
 * Temporary compatibility client for legacy handlers that have not yet been
 * migrated to an injected XeroApi. New code must use createXeroApi instead.
 */
class LegacyXeroClient extends XeroClient {
  readonly tenantId: string;
  private readonly bearerToken?: string;
  private shortCode = "";

  constructor(config: {
    clientId?: string;
    clientSecret?: string;
    bearerToken?: string;
    tenantId?: string;
  }) {
    super({
      clientId: config.clientId ?? "",
      clientSecret: config.clientSecret ?? "",
      grantType: "client_credentials",
      scopes: LEGACY_SCOPES,
    });
    this.bearerToken = config.bearerToken;
    this.tenantId = config.tenantId ?? "";
  }

  async authenticate(): Promise<void> {
    if (this.bearerToken) {
      this.setTokenSet({ access_token: this.bearerToken });
      return;
    }

    await this.getClientCredentialsToken();
  }

  private async getOrganisation(): Promise<Organisation> {
    await this.authenticate();
    const response = await this.accountingApi.getOrganisations(this.tenantId);
    const organisation = response.body.organisations?.[0];

    if (!organisation) {
      throw new Error("Failed to retrieve organisation");
    }

    return organisation;
  }

  async getShortCode(): Promise<string | undefined> {
    if (!this.shortCode) {
      try {
        const organisation = await this.getOrganisation();
        this.shortCode = organisation.shortCode ?? "";
      } catch (error: unknown) {
        throw new Error(
          `Failed to get Organisation short code: ${formatXeroError(error)}`,
        );
      }
    }

    return this.shortCode;
  }
}

/** @deprecated Use createXeroApi with an injected XeroEnvironment. */
export const xeroClient = new LegacyXeroClient({
  clientId: process.env.XERO_CLIENT_ID,
  clientSecret: process.env.XERO_CLIENT_SECRET,
  bearerToken: process.env.XERO_CLIENT_BEARER_TOKEN,
  tenantId: process.env.XERO_TENANT_ID,
});

/** @deprecated Retained only while legacy handlers are being removed. */
export const getClientHeaders = () => ({
  headers: {
    "user-agent": `xero-mcp-server-${getPackageVersion()}`,
  },
});
