export function getApiBaseUrl(): string {
  const override = typeof localStorage !== 'undefined' ? localStorage.getItem('dt-api-base') : null;
  if (override) return override.replace(/\/+$/, '');
  return import.meta.env.VITE_API_URL || '/api';
}

export function getSocketBaseUrl(): string {
  const base = getApiBaseUrl();
  if (/^https?:\/\//.test(base)) {
    return base.replace(/\/api\/?$/, '').replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined') return window.location.origin;
  return '/';
}