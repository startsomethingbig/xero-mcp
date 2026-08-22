export type XeroEnvironment = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  port: number;
  confirmationTtlSeconds: number;
  confirmationSecret: string;
  /** Interface the HTTP listener binds to. Defaults to loopback. */
  bindHost: string;
  /** Extra hostnames accepted in the HTTP `Host` header (loopback is always accepted). */
  allowedHosts: string[];
  /** Extra hostnames accepted in the HTTP `Origin` header (loopback is always accepted). */
  allowedOrigins: string[];
  /** Maximum accepted HTTP request body, in bytes. */
  maxBodyBytes: number;
  /** Shared secret HTTP clients must present as `Authorization: Bearer`. */
  authToken?: string;
};

export type HttpEnvironment = XeroEnvironment & { authToken: string };

export type LoadEnvironmentOptions = { mode?: "stdio" | "http" };

const DEFAULT_PORT = 3000;
const DEFAULT_CONFIRMATION_TTL_SECONDS = 600;
const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const MIN_AUTH_TOKEN_LENGTH = 32;
const WILDCARD_BIND_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);
/** Already trusted by the transport; never needs to be listed. */
const LOOPBACK_BIND_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function parseIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  { fallback, min, max }: { fallback: number; min: number; max: number },
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;

  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(
      `${key} must be an integer between ${min} and ${max} (got "${raw}")`,
    );
  }
  return value;
}

function toHostname(entry: string): string | undefined {
  const withScheme = entry.includes("://") ? entry : `http://${entry}`;
  try {
    const { hostname } = new URL(withScheme);
    return hostname && !hostname.includes("*") ? hostname : undefined;
  } catch {
    return undefined;
  }
}

function parseHostnameListEnv(env: NodeJS.ProcessEnv, key: string): string[] {
  const raw = env[key];
  if (!raw) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const hostname = toHostname(entry);
      if (!hostname) {
        throw new Error(`${key} entry "${entry}" is not a valid hostname`);
      }
      return hostname;
    });
}

/** Format a bind host the way the `Host` header validator expects it. */
function bindHostAsHostname(bindHost: string): string | undefined {
  if (WILDCARD_BIND_HOSTS.has(bindHost) || LOOPBACK_BIND_HOSTS.has(bindHost)) {
    return undefined;
  }
  if (bindHost.includes(":") && !bindHost.startsWith("[")) {
    return `[${bindHost}]`;
  }
  return bindHost;
}

export function loadEnvironment(
  env: NodeJS.ProcessEnv,
  options: { mode: "http" },
): HttpEnvironment;
export function loadEnvironment(
  env: NodeJS.ProcessEnv,
  options?: LoadEnvironmentOptions,
): XeroEnvironment;
export function loadEnvironment(
  env: NodeJS.ProcessEnv,
  options: LoadEnvironmentOptions = {},
): XeroEnvironment {
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

  const bindHost = env.MCP_BIND_HOST?.trim() || "127.0.0.1";
  const bindHostname = bindHostAsHostname(bindHost);
  const allowedHosts = parseHostnameListEnv(env, "MCP_ALLOWED_HOSTS");
  if (bindHostname && !allowedHosts.includes(bindHostname)) {
    allowedHosts.unshift(bindHostname);
  }

  const authToken = env.MCP_AUTH_TOKEN?.trim() || undefined;
  if (options.mode === "http") {
    if (!authToken) {
      throw new Error("MCP_AUTH_TOKEN is required in http mode");
    }
    if (authToken.length < MIN_AUTH_TOKEN_LENGTH) {
      throw new Error(
        `MCP_AUTH_TOKEN must be at least ${MIN_AUTH_TOKEN_LENGTH} characters`,
      );
    }
  }

  return {
    clientId: env.XERO_CLIENT_ID!,
    clientSecret: env.XERO_CLIENT_SECRET!,
    tenantId: env.XERO_TENANT_ID!,
    confirmationSecret: env.XERO_CONFIRMATION_SECRET!,
    port: parseIntegerEnv(env, "PORT", {
      fallback: DEFAULT_PORT,
      min: 0,
      max: 65535,
    }),
    confirmationTtlSeconds: parseIntegerEnv(
      env,
      "XERO_CONFIRMATION_TTL_SECONDS",
      { fallback: DEFAULT_CONFIRMATION_TTL_SECONDS, min: 1, max: 3600 },
    ),
    bindHost,
    allowedHosts,
    allowedOrigins: parseHostnameListEnv(env, "MCP_ALLOWED_ORIGINS"),
    maxBodyBytes: parseIntegerEnv(env, "MCP_MAX_BODY_BYTES", {
      fallback: DEFAULT_MAX_BODY_BYTES,
      min: 1024,
      max: 64 * 1024 * 1024,
    }),
    ...(authToken ? { authToken } : {}),
  };
}
