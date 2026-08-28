import { BadRequestException } from '@nestjs/common';
import * as dns from 'dns/promises';
import * as net from 'net';

/**
 * Plages IPv4 interdites, en notation CIDR. Comparaison faite sur l'entier 32
 * bits de l'adresse (et non un `startsWith` de chaîne, qui laissait passer des
 * cas comme 100.12.x.x — public — pour un préfixe "100.12" censé couvrir la
 * CGNAT 100.64.0.0/10).
 */
const BLOCKED_V4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this host"
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // CGNAT / shared address space (RFC6598)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (inclut 169.254.169.254 — métadonnées cloud)
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved / 255.255.255.255
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) return NaN;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return NaN;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const addr = ipv4ToInt(ip);
  if (Number.isNaN(addr)) return true; // au moindre doute, on bloque
  for (const [base, bits] of BLOCKED_V4_CIDRS) {
    const baseInt = ipv4ToInt(base);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((addr & mask) === (baseInt & mask)) return true;
  }
  return false;
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  if (lower.startsWith('ff')) return true; // multicast
  // IPv4-mapped / IPv4-compatible (::ffff:127.0.0.1, ::ffff:169.254.169.254, …)
  const mapped = lower.match(/(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]);
  const hex = lower.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return isBlockedV4(`${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`);
  }
  return false;
}

function isBlockedIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedV4(ip);
  if (net.isIPv6(ip)) return isBlockedV6(ip);
  return true; // format inconnu → on bloque
}

export async function assertSafeWebhookUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('Invalid webhook URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new BadRequestException('Webhook URL must use HTTPS protocol');
  }

  // Un hostname qui EST déjà une IP littérale : vérifié directement, pas de DNS.
  if (net.isIP(parsed.hostname)) {
    if (isBlockedIP(parsed.hostname)) {
      throw new BadRequestException('Webhook URL must point to a public (non-private) IP address');
    }
    return;
  }

  // On résout À LA FOIS A et AAAA et on vérifie TOUTES les IP. Avant, si
  // resolve4 réussissait on n'inspectait jamais les AAAA — un host dual-stack
  // avec un A public et un AAAA ::1 passait la validation, et undici pouvait
  // ensuite se connecter en IPv6 vers la boucle locale.
  const safeResolve = (p: () => unknown): Promise<string[]> =>
    Promise.resolve()
      .then(p)
      .then((r) => (Array.isArray(r) ? (r as string[]) : []))
      .catch(() => []);

  const [v4, v6] = await Promise.all([
    safeResolve(() => dns.resolve4(parsed.hostname)),
    safeResolve(() => dns.resolve6(parsed.hostname)),
  ]);
  const resolved = [...v4, ...v6];

  if (resolved.length === 0) {
    throw new BadRequestException('Webhook URL hostname could not be resolved');
  }

  for (const ip of resolved) {
    if (isBlockedIP(ip)) {
      throw new BadRequestException('Webhook URL must point to a public (non-private) IP address');
    }
  }
}
