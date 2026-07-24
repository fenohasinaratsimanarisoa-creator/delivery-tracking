import { WsJwtGuard } from './ws-jwt.guard';
import { WsException } from '@nestjs/websockets';

describe('WsJwtGuard', () => {
  let guard: WsJwtGuard;
  let mockWsAuthService: { verify: jest.Mock };

  beforeEach(() => {
    mockWsAuthService = { verify: jest.fn() };
    guard = new WsJwtGuard(mockWsAuthService as any);
  });

  it('should throw WsException when verify fails', async () => {
    mockWsAuthService.verify.mockRejectedValueOnce(new Error('any error'));
    const client = { data: {} };
    const ctx = { switchToWs: () => ({ getClient: () => client }) } as any;
    await expect(guard.canActivate(ctx)).rejects.toThrow(WsException);
  });

  it('should return true when verify succeeds', async () => {
    mockWsAuthService.verify.mockResolvedValueOnce({ id: 'u1', role: 'admin', companyId: 'c1' } as any);
    const client = { data: {} };
    const ctx = { switchToWs: () => ({ getClient: () => client }) } as any;
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });
});