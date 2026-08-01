import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';

export interface CsrfContext {
  token: string;
  hmac: string;
  cookie: string;
}

export async function fetchCsrf(app: INestApplication): Promise<CsrfContext> {
  const res = await request(app.getHttpServer()).get('/auth/csrf-token').expect(200);
  return {
    token: res.body.csrfToken,
    hmac: res.body.csrfHmac,
    cookie: `csrf-token=${res.body.csrfToken}`,
  };
}

export function withCsrf(req: request.Test, csrf: CsrfContext): request.Test {
  return req
    .set('x-csrf-token', csrf.token)
    .set('x-csrf-hmac', csrf.hmac)
    .set('Cookie', csrf.cookie);
}
