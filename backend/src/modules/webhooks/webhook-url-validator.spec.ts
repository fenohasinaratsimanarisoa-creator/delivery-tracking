import { BadRequestException } from '@nestjs/common';
import { assertSafeWebhookUrl } from './webhook-url-validator';

jest.mock('dns/promises', () => ({
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}));

const dns = jest.requireMock('dns/promises');

describe('assertSafeWebhookUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects non-https URLs', async () => {
    await expect(assertSafeWebhookUrl('http://example.com/webhook')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects private IP 127.0.0.1', async () => {
    dns.resolve4.mockResolvedValueOnce(['127.0.0.1']);
    await expect(assertSafeWebhookUrl('https://localhost/webhook')).rejects.toThrow(
      'public (non-private) IP',
    );
  });

  it('rejects private IP 10.x.x.x', async () => {
    dns.resolve4.mockResolvedValueOnce(['10.0.0.5']);
    await expect(assertSafeWebhookUrl('https://internal.corp/webhook')).rejects.toThrow(
      'public (non-private) IP',
    );
  });

  it('rejects private IP 192.168.x.x', async () => {
    dns.resolve4.mockResolvedValueOnce(['192.168.1.1']);
    await expect(assertSafeWebhookUrl('https://router.local/webhook')).rejects.toThrow(
      'public (non-private) IP',
    );
  });

  it('rejects link-local 169.254.x.x', async () => {
    dns.resolve4.mockResolvedValueOnce(['169.254.1.1']);
    await expect(assertSafeWebhookUrl('https://metadata.internal/webhook')).rejects.toThrow(
      'public (non-private) IP',
    );
  });

  it('rejects loopback ::1', async () => {
    dns.resolve4.mockRejectedValueOnce(new Error('no ipv4'));
    dns.resolve6.mockResolvedValueOnce(['::1']);
    await expect(assertSafeWebhookUrl('https://ip6-localhost/webhook')).rejects.toThrow(
      'public (non-private) IP',
    );
  });

  it('accepts public HTTPS URLs', async () => {
    dns.resolve4.mockResolvedValueOnce(['93.184.216.34']);
    await expect(assertSafeWebhookUrl('https://example.com/webhook')).resolves.toBeUndefined();
  });

  it('rejects a dual-stack host with a public A record but a private AAAA record', async () => {
    dns.resolve4.mockResolvedValueOnce(['93.184.216.34']);
    dns.resolve6.mockResolvedValueOnce(['::1']);
    await expect(assertSafeWebhookUrl('https://dual.example/webhook')).rejects.toThrow(
      'public (non-private) IP',
    );
  });

  it('rejects CGNAT / shared address space 100.64.0.0/10', async () => {
    dns.resolve4.mockResolvedValueOnce(['100.100.50.1']);
    await expect(assertSafeWebhookUrl('https://cgnat.example/webhook')).rejects.toThrow(
      'public (non-private) IP',
    );
  });

  it('rejects IPv4-mapped IPv6 pointing at metadata (::ffff:169.254.169.254)', async () => {
    dns.resolve4.mockRejectedValueOnce(new Error('no ipv4'));
    dns.resolve6.mockResolvedValueOnce(['::ffff:169.254.169.254']);
    await expect(assertSafeWebhookUrl('https://mapped.example/webhook')).rejects.toThrow(
      'public (non-private) IP',
    );
  });

  it('rejects an IP-literal hostname in the private range without any DNS lookup', async () => {
    await expect(assertSafeWebhookUrl('https://10.0.0.5/webhook')).rejects.toThrow(
      'public (non-private) IP',
    );
    expect(dns.resolve4).not.toHaveBeenCalled();
  });

  it('rejects invalid URL strings', async () => {
    await expect(assertSafeWebhookUrl('not-a-url')).rejects.toThrow(BadRequestException);
  });
});
