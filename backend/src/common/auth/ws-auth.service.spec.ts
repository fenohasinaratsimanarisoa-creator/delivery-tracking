import { WsAuthService, WsAuthError } from './ws-auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

describe('WsAuthService', () => {
  let service: WsAuthService;
  let jwtService: JwtService;
  let configService: ConfigService;

  beforeEach(() => {
    jwtService = new JwtService({ secret: 'test-secret' });
    configService = { get: jest.fn().mockReturnValue('test-secret') } as any;
    service = new WsAuthService(jwtService, configService);
  });

  const makeClient = (auth?: string) =>
    ({
      handshake: {
        auth: auth ? { token: auth } : {},
        headers: auth ? { authorization: `Bearer ${auth}` } : {},
      },
      data: {},
    }) as any;

  it('should throw on missing token', async () => {
    const client = makeClient();
    await expect(service.verify(client)).rejects.toThrow(WsAuthError);
    await expect(service.verify(client)).rejects.toMatchObject({ code: 'TOKEN_MISSING' });
  });

  it('should throw on invalid token', async () => {
    const client = makeClient('invalid-token');
    await expect(service.verify(client)).rejects.toThrow(WsAuthError);
    await expect(service.verify(client)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('should throw on token without sub', async () => {
    const token = jwtService.sign({ role: 'admin', companyId: 'c1' });
    const client = makeClient(token);
    await expect(service.verify(client)).rejects.toThrow(WsAuthError);
    await expect(service.verify(client)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
  });

  it('should throw on token without companyId', async () => {
    const token = jwtService.sign({ sub: 'u1', role: 'admin' });
    const client = makeClient(token);
    await expect(service.verify(client)).rejects.toThrow(WsAuthError);
    await expect(service.verify(client)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
  });

  it('should accept valid token and set user data', async () => {
    const token = jwtService.sign({
      sub: 'u1',
      email: 'a@b.com',
      role: 'admin',
      companyId: 'c1',
      firstName: 'John',
      lastName: 'Doe',
    });
    const client = makeClient(token);
    const user = await service.verify(client);
    expect(user).toEqual({
      id: 'u1',
      email: 'a@b.com',
      role: 'admin',
      companyId: 'c1',
      firstName: 'John',
      lastName: 'Doe',
    });
    expect(client.data.user).toEqual(user);
  });

  it('should extract token from auth header with Bearer prefix', async () => {
    const token = jwtService.sign({ sub: 'u1', email: 'a@b.com', role: 'admin', companyId: 'c1' });
    const client = {
      handshake: {
        auth: {},
        headers: { authorization: `Bearer ${token}` },
      },
      data: {},
    } as any;
    const user = await service.verify(client);
    expect(user).toBeDefined();
    expect(user.id).toBe('u1');
  });

  it('should set default firstName and lastName when missing', async () => {
    const token = jwtService.sign({
      sub: 'u1',
      email: 'a@b.com',
      role: 'admin',
      companyId: 'c1',
    });
    const client = makeClient(token);
    const user = await service.verify(client);
    expect(user.firstName).toBe('');
    expect(user.lastName).toBe('');
  });
});
