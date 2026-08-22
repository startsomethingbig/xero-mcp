#!/usr/bin/env node

import dotenv from "dotenv";
import type { AddressInfo } from "node:net";

import { loadEnvironment } from "./config/environment.js";
import { createXeroMcpServer } from "./mcp/server.js";
import { createHttpServer } from "./transports/http.js";
import { serveStdio } from "./transports/stdio.js";

dotenv.config();

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

  const dependencies = {};

  if (mode === "http") {
    const environment = loadEnvironment(process.env, { mode: "http" });
    const server = createHttpServer(dependencies, {
      authToken: environment.authToken,
      allowedHosts: environment.allowedHosts,
      allowedOrigins: environment.allowedOrigins,
      maxBodyBytes: environment.maxBodyBytes,
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(environment.port, environment.bindHost, resolve);
    });
    console.error(`xero-mcp http listening on ${describeAddress(server)}`);
    return;
  }

  loadEnvironment(process.env, { mode: "stdio" });
  await serveStdio(() => createXeroMcpServer(dependencies));
};

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
