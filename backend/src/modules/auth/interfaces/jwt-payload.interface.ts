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
  // Identifiant de la UserSession de cette connexion : le refresh token est
  // validé contre CETTE session précise (pas via userId seul), et l'access token
  // le propage à request.user via JwtStrategy.
  sessionId?: string;
  iat?: number;
  exp?: number;
}
