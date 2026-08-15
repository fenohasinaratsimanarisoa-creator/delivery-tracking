import { MobileAppService } from './mobile-app.service';
import { CacheService } from '../../common/cache/cache.service';
import { ConfigService } from '@nestjs/config';

/**
 * Tests du service mobile-app : source de vérité de la version APK.
 * Verrou anti-obsolescence : l'endpoint ne doit JAMAIS renvoyer une version
 * périmée présentée comme à jour — si la release GitHub est absente ou sans
 * asset manifest.json/deliverytrack.apk, il renvoie null (→ 404), jamais un
 * faux positif. Le cache 5 min évite de marteler l'API GitHub publique.
 */
describe('MobileAppService', () => {
  let service: MobileAppService;
  let cache: CacheService;
  const owner = 'test-owner';
  const repo = 'test-repo';

  const release = {
    tag_name: 'v1.2.3',
    published_at: '2026-08-15T10:00:00Z',
    body: 'Changelog release',
    assets: [
      { name: 'deliverytrack.apk', browser_download_url: 'https://example.com/deliverytrack.apk' },
      { name: 'manifest.json', browser_download_url: 'https://example.com/manifest.json' },
    ],
  };

  const manifest = {
    version: '1.2.3',
    versionCode: 42,
    sha256: 'abc123',
    buildDate: '2026-08-15T09:00:00Z',
    changelog: 'fix: tracking',
  };

  beforeEach(() => {
    cache = new CacheService(null);
    service = new MobileAppService(
      new ConfigService({ GITHUB_REPO_OWNER: owner, GITHUB_REPO_NAME: repo }),
      cache,
    );
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockFetch(sequence: unknown[]) {
    let i = 0;
    (global.fetch as jest.Mock).mockImplementation(async () => {
      const body = sequence[i++];
      return { ok: true, json: async () => body };
    });
  }

  it('retourne la release complète (version, url, sha256, buildDate, changelog)', async () => {
    mockFetch([release, manifest]);

    const result = await service.getLatestRelease();

    expect(result).toEqual({
      version: '1.2.3',
      versionCode: 42,
      url: 'https://example.com/deliverytrack.apk',
      sha256: 'abc123',
      buildDate: '2026-08-15T09:00:00Z',
      changelog: 'fix: tracking',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/repos/${owner}/${repo}/releases/latest`),
      expect.anything(),
    );
  });

  it('utilise le cache : la 2e lecture ne refait aucun appel GitHub', async () => {
    mockFetch([release, manifest]);
    await service.getLatestRelease();
    (global.fetch as jest.Mock).mockClear();

    const result = await service.getLatestRelease();
    expect(result).not.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("renvoie null (→ 404) si aucune release n'a jamais été publiée", async () => {
    (global.fetch as jest.Mock).mockImplementation(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));

    const result = await service.getLatestRelease();
    expect(result).toBeNull();
  });

  it('renvoie null si la release est incomplète (asset APK manquant)', async () => {
    // Release sans l'asset deliverytrack.apk → ne JAMAIS servir de version "à jour".
    mockFetch([
      {
        ...release,
        assets: [{ name: 'manifest.json', browser_download_url: 'https://x/manifest.json' }],
      },
    ]);

    const result = await service.getLatestRelease();
    expect(result).toBeNull();
  });

  it("renvoie null si l'API GitHub est injoignable (jamais une version périmée)", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));

    const result = await service.getLatestRelease();
    expect(result).toBeNull();
  });
});
