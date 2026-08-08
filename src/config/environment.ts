export type XeroEnvironment = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  port: number;
  confirmationTtlSeconds: number;
  confirmationSecret: string;
};

export function loadEnvironment(env: NodeJS.ProcessEnv): XeroEnvironment {
  const required = [
    "XERO_CLIENT_ID",
    "XERO_CLIENT_SECRET",
    "XERO_TENANT_ID",
    "XERO_CONFIRMATION_SECRET",
  ] as const;

  for (const key of required) {
    if (!env[key]?.trim()) {
      throw new Error(`${key} is required`);
    }
  }

  return {
    clientId: env.XERO_CLIENT_ID!,
    clientSecret: env.XERO_CLIENT_SECRET!,
    tenantId: env.XERO_TENANT_ID!,
    confirmationSecret: env.XERO_CONFIRMATION_SECRET!,
    port: Number(env.PORT ?? 3000),
    confirmationTtlSeconds: Number(env.XERO_CONFIRMATION_TTL_SECONDS ?? 600),
  };
}
