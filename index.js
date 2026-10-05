import express from "express";
import { createServer } from "node:http";
import { routeRequest, options as wispOptions } from "@mercuryworkshop/wisp-js/server";

const app = express();

app.disable("x-powered-by");

app.get("/", (_request, response) => {
  response.type("text/plain").send("WISP Server Active");
});

const httpServer = createServer(app);

// The library's defaults block private and loopback destinations. Keep those
// protections enabled for a publicly reachable proxy endpoint.
Object.assign(wispOptions, {
  allow_private_ips: false,
  allow_loopback_ips: false,
  allow_direct_ip: true,
  stream_limit_total: 64,
  stream_limit_per_host: 8
});

httpServer.on("upgrade", (request, socket, head) => {
  socket.on("error", (error) => {
    console.error("WebSocket socket error:", error.message);
  });

  let pathname;

  try {
    pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    rejectUpgrade(socket, 400, "Bad Request");
    return;
  }

  if (pathname !== "/wisp/") {
    rejectUpgrade(socket, 404, "Not Found");
    return;
  }

  // routeRequest checks the raw URL, so normalize it to preserve the required
  // trailing slash and remove any query string before handing it to Wisp.
  request.url = "/wisp/";

  try {
    routeRequest(request, socket, head);
  } catch (error) {
    console.error("WISP upgrade failed:", error);
    rejectUpgrade(socket, 400, "Bad Request");
  }
});

function rejectUpgrade(socket, statusCode, message) {
  if (socket.destroyed) return;

  socket.end(
    `HTTP/1.1 ${statusCode} ${message}\r\n` +
      "Connection: close\r\n" +
      "Content-Length: 0\r\n" +
      "\r\n"
  );
}

const port = Number.parseInt(process.env.PORT ?? "10000", 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`WISP server listening on port ${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);

  httpServer.close((error) => {
    if (error) {
      console.error("Error while closing HTTP server:", error);
      process.exitCode = 1;
    }
  });

  // Prevent a stuck WebSocket or request from holding the Render process open.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));