import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole | 'super_admin';
  companyId?: string;
  firstName: string;
  lastName: string;
  type?: 'user' | 'platform_admin';
  scope?: 'access' | '2fa_pending';
  impersonatedBy?: string;
  iat?: number;
  exp?: number;
}
