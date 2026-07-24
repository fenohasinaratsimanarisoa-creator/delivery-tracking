let _adminToken: string | null = null;

export function getAdminToken(): string | null {
  return _adminToken;
}

export function setAdminToken(token: string | null): void {
  _adminToken = token;
}
