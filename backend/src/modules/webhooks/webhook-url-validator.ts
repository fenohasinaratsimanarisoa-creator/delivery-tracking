import { BadRequestException } from '@nestjs/common';
import * as dns from 'dns/promises';

const PRIVATE_RANGES = [
  { prefix: '10.', mask: null },
  { prefix: '172.16.', mask: null },
  { prefix: '172.17.', mask: null },
  { prefix: '172.18.', mask: null },
  { prefix: '172.19.', mask: null },
  { prefix: '172.20.', mask: null },
  { prefix: '172.21.', mask: null },
  { prefix: '172.22.', mask: null },
  { prefix: '172.23.', mask: null },
  { prefix: '172.24.', mask: null },
  { prefix: '172.25.', mask: null },
  { prefix: '172.26.', mask: null },
  { prefix: '172.27.', mask: null },
  { prefix: '172.28.', mask: null },
  { prefix: '172.29.', mask: null },
  { prefix: '172.30.', mask: null },
  { prefix: '172.31.', mask: null },
  { prefix: '192.168.', mask: null },
  { prefix: '127.', mask: null },
  { prefix: '169.254.', mask: null },
  { prefix: '0.', mask: null },
];

function isPrivateIP(ip: string): boolean {
  if (ip === '::1') return true;
  if (ip.startsWith('fe80:')) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
  return PRIVATE_RANGES.some((range) => ip.startsWith(range.prefix));
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

  let resolved: string[];
  try {
    resolved = await dns.resolve4(parsed.hostname);
  } catch {
    try {
      resolved = await dns.resolve6(parsed.hostname);
    } catch {
      throw new BadRequestException('Webhook URL hostname could not be resolved');
    }
  }

  for (const ip of resolved) {
    if (isPrivateIP(ip)) {
      throw new BadRequestException('Webhook URL must point to a public (non-private) IP address');
    }
  }
}
