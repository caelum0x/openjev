import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Shared SSRF guard for every feature that fetches a URL supplied by a
 * request body: outbound webhooks (webhooks.server.ts) and external benchmark
 * submissions (benchmark-submissions.server.ts) both call a caller-chosen
 * http(s) URL, so both must reject loopback/private/link-local/metadata
 * targets the same way. Extracted here so there is exactly one SSRF
 * implementation instead of two that could silently drift apart.
 */

/** `URL#hostname` wraps IPv6 literals in brackets (e.g. "[::1]"); `net.isIP`
 * only recognizes the bare address, so strip them before any IP check. */
export function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * True for an IPv4/IPv6 literal inside loopback, link-local (incl. the
 * 169.254.169.254 cloud metadata address), RFC1918 private, CGNAT, or
 * unspecified ranges. A Docker-compose bridge network hands out addresses in
 * these same ranges, so this also covers internal service IPs like `db` or
 * `laya-onnx` once resolved.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local fc00::/7
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateOrReservedIp(mapped[1]) : false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 0) return true; // 0.0.0.0/8 unspecified
  return false;
}

/** True when `url` is a well-formed http(s) URL with a host that is not a
 * literal loopback/private/link-local address. Does not resolve hostnames —
 * see `assertPublicAddress` for the DNS-resolution check done at call time
 * (also blocks hostnames that resolve to a private address). */
export function isValidOutboundUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (!u.host) return false;
    const hostname = stripIpv6Brackets(u.hostname.toLowerCase());
    if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
    if (isIP(hostname) && isPrivateOrReservedIp(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves `hostname` and throws when it is, or resolves to, a loopback,
 * private, or link-local address. Closes the SSRF gap `isValidOutboundUrl`
 * can't: a public-looking hostname (or an internal docker-compose service
 * name like `laya-onnx`/`db`) that resolves to an internal address.
 */
export async function assertPublicAddress(rawHostname: string): Promise<void> {
  const hostname = stripIpv6Brackets(rawHostname.toLowerCase());
  if (isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error("URL resolves to a private address");
    }
    return;
  }
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some((r) => isPrivateOrReservedIp(r.address))) {
    throw new Error("URL resolves to a private address");
  }
}

/**
 * Full guard for a caller-supplied URL: well-formed http(s), not a literal
 * private/loopback address, AND (via DNS resolution) does not resolve to one
 * either. Throws with a caller-safe message on any failure.
 */
export async function assertSafeOutboundUrl(url: string): Promise<void> {
  if (!isValidOutboundUrl(url)) {
    throw new Error("URL must be a valid http(s) URL and not a private address");
  }
  await assertPublicAddress(new URL(url).hostname);
}
