import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseVersion,
  isVersionOutdated,
  fetchLatestMobileApp,
  hasDismissedMobileAppBanner,
  dismissMobileAppBanner,
  MOBILE_APP_DISMISS_KEY,
} from './mobileApp';

/**
 * Verrou anti-obsolescence côté frontend : la comparaison de versions et la
 * lecture de l'endpoint ne doivent JAMAIS produire de faux « à jour » ni de
 * fausse version affichée. Si la release n'existe pas (404) ou l'appel échoue,
 * fetchLatestMobileApp renvoie null — la bannière ne s'affiche pas.
 */
describe('parseVersion', () => {
  it('parse les formats semver courants', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2')).toEqual([1, 2, 0]);
    expect(parseVersion('1')).toEqual([1, 0, 0]);
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
  });

  it('renvoie null pour un format illisible', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('abc')).toBeNull();
    expect(parseVersion('1.2.3.4-beta')).not.toBeNull(); // préfixe numérique valide
  });
});

describe('isVersionOutdated', () => {
  it('détecte une mise à jour disponible', () => {
    expect(isVersionOutdated('1.0.0', '1.0.1')).toBe(true);
    expect(isVersionOutdated('1.0.9', '1.1.0')).toBe(true);
    expect(isVersionOutdated('0.9.0', '1.0.0')).toBe(true);
  });

  it('ne signale pas de mise à jour quand la version est égale ou supérieure', () => {
    expect(isVersionOutdated('1.2.3', '1.2.3')).toBe(false);
    expect(isVersionOutdated('1.2.4', '1.2.3')).toBe(false);
    expect(isVersionOutdated('2.0.0', '1.9.9')).toBe(false);
  });

  it('ne bloque jamais sur une version illisible (faux positif impossible)', () => {
    expect(isVersionOutdated('', '1.0.0')).toBe(false);
    expect(isVersionOutdated('inconnue', '1.0.0')).toBe(false);
    expect(isVersionOutdated('1.0.0', '')).toBe(false);
  });
});

describe('fetchLatestMobileApp', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retourne la release quand l\'endpoint répond 200', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.2.3', versionCode: 42, url: 'https://x/apk', sha256: 'abc', buildDate: '2026-08-15' }),
    });
    const result = await fetchLatestMobileApp();
    expect(result).not.toBeNull();
    expect(result!.version).toBe('1.2.3');
  });

  it('retourne null si aucune release (404) — jamais de version inventée', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 404 });
    expect(await fetchLatestMobileApp()).toBeNull();
  });

  it('retourne null si l\'appel échoue (réseau) — la bannière reste silencieuse', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    expect(await fetchLatestMobileApp()).toBeNull();
  });
});

describe('dismissal (localStorage)', () => {
  afterEach(() => {
    try {
      localStorage.removeItem(MOBILE_APP_DISMISS_KEY);
    } catch {}
  });

  it('masque durablement la bannière après « j\'ai déjà l\'app »', () => {
    expect(hasDismissedMobileAppBanner()).toBe(false);
    dismissMobileAppBanner();
    expect(hasDismissedMobileAppBanner()).toBe(true);
  });
});
