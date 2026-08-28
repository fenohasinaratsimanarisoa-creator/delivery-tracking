import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../common/cache/cache.service';

export interface MobileAppRelease {
  version: string;
  versionCode: number;
  url: string;
  sha256: string;
  /**
   * Empreinte SHA-256 du CERTIFICAT DE SIGNATURE de l'APK publié.
   *
   * Android refuse d'installer une mise à jour signée avec une clé différente de
   * l'app déjà installée, en n'affichant qu'un « Application non installée »
   * opaque (incident 2026-08-28 : les chauffeurs avaient un APK de debug, la CI
   * publie un APK de release). L'app compare cette empreinte à celle de sa
   * propre signature pour afficher la bonne consigne au lieu d'un lien qui
   * échouera. Chaîne vide si la release est antérieure à cette publication.
   */
  signerSha256: string;
  buildDate: string;
  changelog?: string;
}

const CACHE_TTL_S = 300; // 5 min : la release ne change qu'à chaque build CI

/**
 * Source de vérité de l'APK mobile : la dernière GitHub Release publiée par la
 * CI (job android-release). La CI publie à CHAQUE push sur main une release
 * vX.Y.Z avec 2 assets : deliverytrack.apk + manifest.json (version, versionCode,
 * sha256, buildDate, changelog). Ce service lit manifest.json via l'API publique
 * GitHub (sans auth — le repo est public), avec cache 5 min.
 *
 * AUCUNE URL ni version codée en dur : le frontend et l'app mobile interrogent
 * cet endpoint, qui reflète toujours la dernière release réellement buildée.
 * Si la CI n'a jamais publié (ou a échoué), l'endpoint renvoie 404 — jamais une
 * version périmée présentée comme à jour.
 */
@Injectable()
export class MobileAppService {
  private readonly logger = new Logger(MobileAppService.name);
  private readonly owner: string;
  private readonly repo: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {
    // Défauts = repo de production ; surchargeable via env (tests, fork).
    this.owner = this.configService.get<string>(
      'GITHUB_REPO_OWNER',
      'fenohasinaratsimanarisoa-creator',
    );
    this.repo = this.configService.get<string>('GITHUB_REPO_NAME', 'delivery-tracking');
  }

  private manifestUrl(): string {
    // L'asset manifest.json d'une release a une URL directe stable :
    // releases/download/<tag>/manifest.json (résout vers le stockage GitHub).
    // On la découvre via l'API releases/latest (tag courant) pour ne jamais
    // supposer le numéro de version côté serveur.
    return `https://api.github.com/repos/${this.owner}/${this.repo}/releases/latest`;
  }

  /** URL de téléchargement directe d'un asset nommé (via l'API, pas supposée). */
  private async resolveAssetDownloadUrl(
    latestRelease: { assets: Array<{ name: string; browser_download_url: string }> },
    assetName: string,
  ): Promise<string | null> {
    const asset = latestRelease.assets?.find((a) => a.name === assetName);
    return asset?.browser_download_url ?? null;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'deliverytrack-backend' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} for ${url}`);
    }
    return res.json() as Promise<T>;
  }

  /**
   * Dernière version publiée, ou null si aucune release (pas encore de build CI).
   * L'erreur GitHub (rate limit, réseau) renvoie null — le cache 5 min évite de
   * marteler l'API publique à chaque visite du dashboard.
   */
  async getLatestRelease(): Promise<MobileAppRelease | null> {
    const cacheKey = 'mobile-app:latest';
    const cached = await this.cacheService.get<MobileAppRelease>(cacheKey);
    if (cached) return cached;

    try {
      const latest = await this.fetchJson<{
        tag_name: string;
        published_at: string;
        body?: string | null;
        assets: Array<{ name: string; browser_download_url: string }>;
      }>(this.manifestUrl());

      const manifestUrl = await this.resolveAssetDownloadUrl(latest, 'manifest.json');
      const apkUrl = await this.resolveAssetDownloadUrl(latest, 'deliverytrack.apk');
      if (!manifestUrl || !apkUrl) {
        this.logger.warn('Latest release without manifest.json/deliverytrack.apk asset — skipping');
        return null;
      }

      const manifest = await this.fetchJson<{
        version?: string;
        versionCode?: number;
        sha256?: string;
        signerSha256?: string;
        buildDate?: string;
        changelog?: string;
      }>(manifestUrl);

      // Version en dur dans manifest.json (écrit par la CI à partir de
      // build.gradle) — jamais dérivée du tag (un tag manuel pourrait diverger).
      const release: MobileAppRelease = {
        version: manifest.version ?? latest.tag_name.replace(/^v/, ''),
        versionCode: manifest.versionCode ?? 0,
        url: apkUrl,
        sha256: manifest.sha256 ?? '',
        signerSha256: manifest.signerSha256 ?? '',
        buildDate: manifest.buildDate ?? latest.published_at,
        changelog: manifest.changelog ?? latest.body ?? undefined,
      };
      await this.cacheService.set(cacheKey, release, CACHE_TTL_S);
      return release;
    } catch (err) {
      this.logger.warn(`mobile-app/latest unavailable: ${(err as Error).message}`);
      return null;
    }
  }
}
