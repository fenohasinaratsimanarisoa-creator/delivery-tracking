import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseVersion,
  isVersionOutdated,
  compareBuild,
  requiresReinstall,
  CRITICAL_BUILD_GAP,
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

/**
 * VERROU (audit 2026-08-28) : le versionName peut se FIGER — c'est arrivé
 * réellement, deux APK différents ont porté « 0.0.59 » à cause d'un défaut de
 * calcul de version dans la CI. Une détection d'obsolescence basée sur le nom
 * concluait alors « à jour » alors que l'appareil tournait un binaire sans les
 * correctifs natifs de perte de données GPS. Le versionCode
 * (`git rev-list --count`) est strictement croissant : c'est le seul
 * identifiant sur lequel on peut conclure.
 */
describe('compareBuild — détection par versionCode', () => {
  it('détecte un APK en retard', () => {
    expect(compareBuild('435', 459)).toEqual({ outdated: true, gap: 24 });
  });

  it('ne signale rien quand la version installée est à jour', () => {
    expect(compareBuild('459', 459)).toEqual({ outdated: false, gap: 0 });
  });

  it("ne signale rien si l'appareil est en AVANCE (build local de dev)", () => {
    expect(compareBuild('460', 459)).toEqual({ outdated: false, gap: -1 });
  });

  it('LE CAS RÉEL : versionName identique mais versionCode en retard', () => {
    // Deux APK nommés « 0.0.59 » : isVersionOutdated ne voit rien...
    expect(isVersionOutdated('0.0.59', '0.0.59')).toBe(false);
    // ...alors que le versionCode prouve un retard de 24 commits.
    expect(compareBuild('435', 459)?.outdated).toBe(true);
  });

  it('classe le retard comme critique au-delà du seuil', () => {
    const justUnder = compareBuild(String(459 - (CRITICAL_BUILD_GAP - 1)), 459)!;
    const atThreshold = compareBuild(String(459 - CRITICAL_BUILD_GAP), 459)!;
    expect(justUnder.gap >= CRITICAL_BUILD_GAP).toBe(false);
    expect(atThreshold.gap >= CRITICAL_BUILD_GAP).toBe(true);
  });

  it('retourne null sur une donnée illisible (jamais de fausse alerte bloquante)', () => {
    expect(compareBuild(undefined, 459)).toBeNull();
    expect(compareBuild('', 459)).toBeNull();
    expect(compareBuild('abc', 459)).toBeNull();
    expect(compareBuild('0', 459)).toBeNull();
    expect(compareBuild('435', undefined)).toBeNull();
    expect(compareBuild('435', 0)).toBeNull();
  });
});

/**
 * VERROU (incident 2026-08-28) : les chauffeurs avaient un APK de DEBUG
 * (CN=Android Debug) tandis que la CI publie un APK signé avec la clé de
 * release. Android refuse alors l'installation par-dessus et n'affiche qu'un
 * « Application non installée » opaque. La bannière proposait un lien de
 * téléchargement qui ne pouvait PAS aboutir.
 */
describe('requiresReinstall — signatures incompatibles', () => {
  const DEBUG = 'e61838f036ef803b76ec45488a6d5dd2ac8213fb4b5386805cbe1f01e879b0a4';
  const RELEASE = 'ff648d75dc1aad1650f5cdb0bddff05121b6730d941de999bd629bce8d93809f';

  it('LE CAS RÉEL : APK debug installé, release publiée -> réinstallation requise', () => {
    expect(requiresReinstall(DEBUG, RELEASE)).toBe(true);
  });

  it('même clé -> mise à jour normale possible', () => {
    expect(requiresReinstall(RELEASE, RELEASE)).toBe(false);
  });

  it('insensible à la casse et aux espaces', () => {
    expect(requiresReinstall(` ${RELEASE.toUpperCase()} `, RELEASE)).toBe(false);
  });

  it('ne conclut JAMAIS sur une donnée manquante (pas de consigne infondée)', () => {
    expect(requiresReinstall(undefined, RELEASE)).toBe(false);
    expect(requiresReinstall(DEBUG, undefined)).toBe(false);
    expect(requiresReinstall('', RELEASE)).toBe(false);
    expect(requiresReinstall(DEBUG, '')).toBe(false);
  });
});
