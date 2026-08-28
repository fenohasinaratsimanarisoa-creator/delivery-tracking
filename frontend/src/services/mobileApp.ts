import { getApiBaseUrl } from './api/config';

export interface MobileAppRelease {
  version: string;
  versionCode: number;
  url: string;
  sha256: string;
  buildDate: string;
  changelog?: string;
}

/**
 * Parse une version semver "X.Y.Z" en [major, minor, patch] numériques.
 * Tolère les formats "1", "1.2", "v1.2.3". Retourne null si illisible.
 */
export function parseVersion(version: string): [number, number, number] | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
  if (!m) return null;
  return [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/**
 * Compare deux versions semver. Retourne true si installed < latest
 * (une mise à jour est disponible). Une version illisible n'est jamais
 * considérée comme obsolète (on ne bloque pas l'app sur un faux positif).
 */
export function isVersionOutdated(installed: string, latest: string): boolean {
  const a = parseVersion(installed);
  const b = parseVersion(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

/**
 * Écart de versionCode à partir duquel la mise à jour devient CRITIQUE.
 *
 * versionCode = nombre de commits (voir le job `android-release` de la CI) : un
 * écart de 20 commits représente typiquement plusieurs jours de correctifs, dont
 * potentiellement des correctifs de PERTE DE DONNÉES GPS côté natif (les
 * correctifs A1/A2/A3 de l'audit 2026-08-28 ne vivent QUE dans l'APK — un
 * serveur à jour ne les compense pas).
 */
export const CRITICAL_BUILD_GAP = 20;

/**
 * Compare les versionCode (Android) installé et publié.
 *
 * POURQUOI PAS LE versionName (audit 2026-08-28) : le versionName est calculé
 * par la CI à partir des tags git et PEUT SE FIGER — c'est arrivé réellement,
 * deux APK différents ont porté « 0.0.59 ». Une comparaison par nom concluait
 * alors « à jour » alors que l'appareil tournait un binaire de plusieurs jours
 * plus ancien, sans les correctifs natifs de perte de données GPS.
 *
 * Le versionCode, lui, vaut `git rev-list --count HEAD` : strictement croissant,
 * jamais réutilisé, indépendant des tags. C'est le seul identifiant fiable.
 *
 * Retourne null si l'un des deux est illisible (on ne conclut JAMAIS à
 * l'obsolescence sur une donnée douteuse — pas de fausse alerte bloquante).
 */
export function compareBuild(
  installedBuild: string | undefined,
  latestVersionCode: number | undefined,
): { outdated: boolean; gap: number } | null {
  const installed = Number(installedBuild);
  if (!Number.isFinite(installed) || installed <= 0) return null;
  if (!Number.isFinite(latestVersionCode) || (latestVersionCode ?? 0) <= 0) return null;
  const gap = (latestVersionCode as number) - installed;
  return { outdated: gap > 0, gap };
}

/**
 * Dernière version APK publiée (endpoint public rate-limité).
 * Retourne null si aucune release n'a encore été buildée par la CI ou si
 * l'appel échoue — le frontend ne doit jamais afficher une version inventée.
 */
export async function fetchLatestMobileApp(): Promise<MobileAppRelease | null> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/mobile-app/latest`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as MobileAppRelease;
  } catch {
    return null;
  }
}

/** Clé localStorage : l'utilisateur a déclaré avoir déjà l'app (masquage durable). */
export const MOBILE_APP_DISMISS_KEY = 'dt_mobile_app_installed';

export function hasDismissedMobileAppBanner(): boolean {
  try {
    return localStorage.getItem(MOBILE_APP_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissMobileAppBanner(): void {
  try {
    localStorage.setItem(MOBILE_APP_DISMISS_KEY, '1');
  } catch {
    /* stockage indisponible — ignore */
  }
}
