import { ExecutionContext } from '@nestjs/common';
import { GoogleAuthStateGuard, OAUTH_WEB_STATE_COOKIE } from './google-auth-state.guard';

function ctx(query: Record<string, unknown>, res: { cookie: jest.Mock }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ query }),
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

describe('GoogleAuthStateGuard', () => {
  const guard = new GoogleAuthStateGuard();

  it('flux natif : relaie le state entrant SANS poser de cookie web', () => {
    const res = { cookie: jest.fn() };
    const opts = guard.getAuthenticateOptions(ctx({ state: 'relay-123' }, res));
    expect(opts).toEqual({ session: false, state: 'relay-123' });
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('flux web : génère un nonce, le pose en cookie httpOnly Lax, et le passe à Google', () => {
    const res = { cookie: jest.fn() };
    const opts = guard.getAuthenticateOptions(ctx({}, res)) as {
      session: boolean;
      state: string;
    };
    expect(opts.session).toBe(false);
    expect(typeof opts.state).toBe('string');
    expect(opts.state.length).toBeGreaterThanOrEqual(32);
    expect(res.cookie).toHaveBeenCalledWith(
      OAUTH_WEB_STATE_COOKIE,
      opts.state,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });
});
