#!/usr/bin/env node

import { loadEnvironment } from "./config/environment.js";
import { createXeroMcpServer } from "./mcp/server.js";
import { createHttpServer } from "./transports/http.js";
import { serveStdio } from "./transports/stdio.js";

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

  const environment = loadEnvironment(process.env);
  const dependencies = {};

  if (mode === "http") {
    await new Promise<void>((resolve, reject) => {
      const server = createHttpServer(dependencies);
      server.once("error", reject);
      server.listen(environment.port, resolve);
    });
    return;
  }

  await serveStdio(() => createXeroMcpServer(dependencies));
};

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
