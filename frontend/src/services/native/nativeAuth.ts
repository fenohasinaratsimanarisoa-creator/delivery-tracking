export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && Boolean(
    (window as unknown as { Capacitor?: { isNativePlatform?: boolean } }).Capacitor?.isNativePlatform,
  );
}

export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod/i.test(ua);
}

export function isWebView(): boolean {
  if (isNativeApp()) return true;
  if (typeof navigator === 'undefined') return false;
  return /wv|WebView|AppleWebKit\/.+ Mobile\/.*Safari/i.test(navigator.userAgent || '');
}

export async function openGoogleOAuthInNative(): Promise<void> {
  const url = `${window.location.origin}/api/auth/google`;
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url });
}

export function relayTokenToNativeApp(token: string): void {
  window.location.replace(`logitrack://auth#accessToken=${encodeURIComponent(token)}`);
}

export function initNativeOAuthListener(): void {
  if (!isNativeApp()) return;
  void import('@capacitor/app').then(({ App }) => {
    void App.addListener('appUrlOpen', (data: { url: string }) => {
      try {
        const url = new URL(data.url);
        if (url.protocol !== 'logitrack:') return;
        const token = url.hash ? new URLSearchParams(url.hash.slice(1)).get('accessToken') : null;
        if (token) {
          window.location.href = `${window.location.origin}/auth/callback#accessToken=${encodeURIComponent(token)}`;
        }
      } catch {
        /* malformed deep link — ignore */
      }
    });
  });
}