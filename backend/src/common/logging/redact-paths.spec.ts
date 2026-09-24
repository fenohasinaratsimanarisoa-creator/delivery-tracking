import pino from 'pino';
import { Writable } from 'stream';
import { LOG_REDACT } from './redact-paths';

// Audit A→Z 2026-09-24 : chaque erreur HTTP journalisée contenait x-csrf-token et
// x-csrf-hmac en clair. Vérifié avec le VRAI moteur de masquage pino, sur la forme
// { req, res } produite par pino-http.
const logOnce = (obj: Record<string, unknown>) => {
  let out = '';
  const sink = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  pino({ redact: LOG_REDACT }, sink).error(obj, 'boom');
  return out;
};

describe('LOG_REDACT — secrets jamais écrits dans les journaux', () => {
  const secrets = {
    authorization: 'Bearer SECRET-JWT',
    cookie: 'refreshToken=SECRET-COOKIE',
    'x-csrf-token': 'SECRET-CSRF-TOKEN',
    'x-csrf-hmac': 'SECRET-CSRF-HMAC',
    'x-api-key': 'SECRET-API-KEY',
    'x-mm-signature': 'SECRET-MM-SIGNATURE',
  };

  it('en-têtes de requête secrets masqués, en-têtes utiles conservés', () => {
    const out = logOnce({
      req: {
        method: 'POST',
        url: '/auth/refresh',
        headers: { ...secrets, host: 'backend:3000', 'user-agent': 'Chrome' },
      },
    });
    expect(out).not.toMatch(/SECRET-/);
    const req = JSON.parse(out).req;
    for (const h of Object.keys(secrets)) expect(req.headers[h]).toBe('[REDACTED]');
    expect(req.headers.host).toBe('backend:3000');
    expect(req.headers['user-agent']).toBe('Chrome');
  });

  it('Set-Cookie de réponse et champs sensibles du corps masqués', () => {
    const out = logOnce({
      res: { statusCode: 200, headers: { 'set-cookie': ['refreshToken=SECRET-SETCOOKIE'] } },
      body: {
        password: 'SECRET-PW',
        token: 'SECRET-T',
        refreshToken: 'SECRET-RT',
        accessToken: 'SECRET-AT',
        secret: 'SECRET-S',
        email: 'a@b.c',
      },
    });
    expect(out).not.toMatch(/SECRET-/);
    expect(JSON.parse(out).body.email).toBe('a@b.c');
  });
});
