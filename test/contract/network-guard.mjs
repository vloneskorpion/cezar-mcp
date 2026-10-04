/** Test-only guard: the pinned server has no switch disabling its registry startup read. */
import net from "node:net";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync } from "node:fs";
const allowed = (host) =>
  typeof host === "string" &&
  (host === "::1" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host));
const blocked = (host) => {
  if (process.env.CEZAR_TEST_NETWORK_LOG)
    appendFileSync(
      process.env.CEZAR_TEST_NETWORK_LOG,
      `${String(host).slice(0, 200)}\n`,
    );
  throw new Error("Live conformance blocks external network access");
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (!allowed(url.hostname.replace(/^\[|\]$/g, "")))
    return Promise.reject(
      new Error("External fetch disabled by live conformance"),
    );
  return originalFetch(input, { ...init, redirect: "error" });
};
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  if (Array.isArray(args[0])) args = args[0];
  const value = args[0];
  if (typeof value === "string") blocked("unix socket");
  const options =
    typeof value === "object"
      ? value
      : { host: typeof args[1] === "string" ? args[1] : "127.0.0.1" };
  if (options.path || !allowed(options.host ?? "127.0.0.1"))
    blocked(options.host ?? "unix socket");
  return originalConnect.apply(this, args);
};
for (const module of [http, https, tls])
  for (const key of ["request", "get", "connect"])
    if (typeof module[key] === "function") {
      const original = module[key];
      module[key] = function (...args) {
        const value = args[0];
        const host =
          typeof value === "string" || value instanceof URL
            ? new URL(value).hostname
            : (value?.hostname ?? value?.host ?? "127.0.0.1");
        if (!allowed(host.replace(/^\[|\]$/g, ""))) blocked(host);
        return original.apply(this, args);
      };
    }
syncBuiltinESMExports();
