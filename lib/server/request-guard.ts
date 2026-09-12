import { timingSafeEqual } from "node:crypto";
import type { AccessPolicy } from "./storage-types.ts";

export function requestDenied(request: Request, policy: AccessPolicy): string | null {
  const url = new URL(request.url);
  let expectedOrigin = url.origin;
  if (policy.mode === "hosted") {
    expectedOrigin = policy.origin;
    const expectedHost = new URL(expectedOrigin).host;
    const supplied = Buffer.from(request.headers.get("x-folio-proxy-key") || "");
    const expected = Buffer.from(policy.proxyKey);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return "Authenticated proxy access is required.";
    }
    if (request.headers.get("host") !== expectedHost || request.headers.get("x-forwarded-proto") !== "https") {
      return "Invalid workspace origin.";
    }
    if (request.method !== "GET" && request.headers.get("origin") !== expectedOrigin) {
      return "A same-origin request is required.";
    }
  } else if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return "This personal workspace accepts local connections only.";
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== expectedOrigin) return "Cross-origin requests are not allowed.";
  if (request.headers.get("sec-fetch-site") === "cross-site") return "Cross-site requests are not allowed.";
  return null;
}
