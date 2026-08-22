#!/usr/bin/env node

import dotenv from "dotenv";
import type { AddressInfo } from "node:net";

import { loadEnvironment } from "./config/environment.js";
import { redactErrorMessage } from "./helpers/format-error.js";
import { createServerDependencies } from "./mcp/dependencies.js";
import { createXeroMcpServer } from "./mcp/server.js";
import { createHttpServer } from "./transports/http.js";
import { serveStdio } from "./transports/stdio.js";

// quiet: dotenv must never write to stdout, which stdio mode uses for protocol frames.
dotenv.config({ quiet: true });

/** Secret literals to scrub from anything we log. */
let knownSecrets: string[] = [];

function reportError(error: unknown): void {
  console.error(`xero-mcp: ${redactErrorMessage(error, knownSecrets)}`);
}

function installShutdown(close: () => Promise<void>): void {
  const shutdown = () => {
    close()
      .catch(reportError)
      .finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function describeAddress(server: { address(): unknown }): string {
  const address = server.address() as AddressInfo | string | null;
  if (!address || typeof address === "string") return String(address);
  const host =
    address.family === "IPv6" ? `[${address.address}]` : address.address;
  return `http://${host}:${address.port}/mcp`;
}

const main = async () => {
  const args = process.argv.slice(2);
  const mode = args[0];

  if (
    args.length > 1 ||
    (mode !== undefined && mode !== "stdio" && mode !== "http")
  ) {
    console.error("Usage: xero-mcp-server [stdio|http]");
    process.exitCode = 2;
    return;
  }

  if (mode === "http") {
    const environment = loadEnvironment(process.env, { mode: "http" });
    knownSecrets = [
      environment.clientSecret,
      environment.confirmationSecret,
      environment.authToken,
    ];
    const dependencies = createServerDependencies(environment);
    const server = createHttpServer(dependencies, {
      authToken: environment.authToken,
      allowedHosts: environment.allowedHosts,
      allowedOrigins: environment.allowedOrigins,
      maxBodyBytes: environment.maxBodyBytes,
      onError: reportError,
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(environment.port, environment.bindHost, resolve);
    });
    console.error(`xero-mcp http listening on ${describeAddress(server)}`);
    installShutdown(
      () =>
        new Promise<void>((resolve, reject) => {
          server.closeIdleConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    return;
  }

  const environment = loadEnvironment(process.env, { mode: "stdio" });
  knownSecrets = [environment.clientSecret, environment.confirmationSecret];
  const dependencies = createServerDependencies(environment);
  const handle = serveStdio(() => createXeroMcpServer(dependencies), {
    onerror: reportError,
  });
  installShutdown(() => handle.close());
};

main().catch((error) => {
  reportError(error);
  process.exit(1);
});
