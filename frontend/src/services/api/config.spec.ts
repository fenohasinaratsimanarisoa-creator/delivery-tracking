import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getApiBaseUrl, initApiOverrideBanner, getSocketBaseUrl } from './config';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  document.body.innerHTML = '';
});

describe('getApiBaseUrl — double opt-in en production', () => {
  it('retourne /api par défaut (ni override ni VITE_API_URL)', () => {
    expect(getApiBaseUrl()).toBe('/api');
  });

  it('retourne VITE_API_URL si pas d\'override', () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:3000/api');
    expect(getApiBaseUrl()).toBe('http://localhost:3000/api');
  });

  describe('en développement (PROD=false)', () => {
    beforeEach(() => {
      vi.stubEnv('PROD', false);
    });

    it('utilise dt-api-base sans demander d\'opt-in', () => {
      localStorage.setItem('dt-api-base', 'http://dev-local:4000/api');
      expect(getApiBaseUrl()).toBe('http://dev-local:4000/api');
    });

    it('supprime les slashes trailing de l\'override', () => {
      localStorage.setItem('dt-api-base', 'http://dev-local:4000/api///');
      expect(getApiBaseUrl()).toBe('http://dev-local:4000/api');
    });
  });

  describe('en production (PROD=true)', () => {
    beforeEach(() => {
      vi.stubEnv('PROD', true);
      vi.stubEnv('VITE_API_URL', '');
    });

    it('IGNORE dt-api-base sans double opt-in', () => {
      localStorage.setItem('dt-api-base', 'http://wrong-server:9999/api');
      expect(getApiBaseUrl()).toBe('/api');
    });

    it('utilise dt-api-base AVEC double opt-in (dt-allow-api-override=1)', () => {
      localStorage.setItem('dt-api-base', 'http://custom:7777/api');
      localStorage.setItem('dt-allow-api-override', '1');
      expect(getApiBaseUrl()).toBe('http://custom:7777/api');
    });

    it('IGNORE dt-api-base si dt-allow-api-override≠1', () => {
      localStorage.setItem('dt-api-base', 'http://custom:7777/api');
      localStorage.setItem('dt-allow-api-override', '0');
      expect(getApiBaseUrl()).toBe('/api');
    });

    it('retourne VITE_API_URL si pas d\'override', () => {
      vi.stubEnv('VITE_API_URL', 'https://prod-api.example.com');
      expect(getApiBaseUrl()).toBe('https://prod-api.example.com');
    });

    it('supprime les slashes trailing de l\'override en prod', () => {
      localStorage.setItem('dt-api-base', 'http://custom:7777/api/');
      localStorage.setItem('dt-allow-api-override', '1');
      expect(getApiBaseUrl()).toBe('http://custom:7777/api');
    });
  });

  it('log console.info au démarrage dans tous les cas', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    getApiBaseUrl();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[api] Base URL :'));
    spy.mockRestore();
  });
});

describe('initApiOverrideBanner', () => {
  it('ne crée rien si pas d\'override', () => {
    initApiOverrideBanner();
    expect(document.getElementById('dt-api-override-banner')).toBeNull();
  });

  it('crée la bannière en dev avec un override', () => {
    vi.stubEnv('PROD', false);
    localStorage.setItem('dt-api-base', 'http://dev-local:4000/api');
    initApiOverrideBanner();
    const banner = document.getElementById('dt-api-override-banner');
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute('role')).toBe('alert');
    expect(banner!.textContent).toContain('dev-local:4000/api');
    expect(banner!.textContent).toContain('DEV');
  });

  it('crée la bannière en prod AVEC double opt-in', () => {
    vi.stubEnv('PROD', true);
    localStorage.setItem('dt-api-base', 'http://custom:7777/api');
    localStorage.setItem('dt-allow-api-override', '1');
    initApiOverrideBanner();
    const banner = document.getElementById('dt-api-override-banner');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('PRODUCTION');
  });

  it('N\'EXISTE PAS en prod SANS double opt-in', () => {
    vi.stubEnv('PROD', true);
    localStorage.setItem('dt-api-base', 'http://custom:7777/api');
    initApiOverrideBanner();
    expect(document.getElementById('dt-api-override-banner')).toBeNull();
  });

  it('la bannière a un style rouge fixe en haut', () => {
    vi.stubEnv('PROD', false);
    localStorage.setItem('dt-api-base', 'http://dev-local:4000/api');
    initApiOverrideBanner();
    const banner = document.getElementById('dt-api-override-banner')!;
    expect(banner.style.position).toBe('fixed');
    expect(banner.style.top).toBe('0px');
    // JSDOM normalise les couleurs en rgb() — vérifier que c'est bien un rouge
    expect(banner.style.background).toMatch(/rgb\(220,\s*38,\s*38\)/);
    expect(banner.style.color).toMatch(/rgb\(255,\s*255,\s*255\)|#fff/i);
  });
});

describe('getSocketBaseUrl', () => {
  it('extrait l\'origine depuis une URL API complète', () => {
    localStorage.setItem('dt-api-base', 'http://my-server:3000/api');
    expect(getSocketBaseUrl()).toBe('http://my-server:3000');
  });

  it('retourne window.location.origin si base relative', () => {
    expect(getSocketBaseUrl()).toBe(window.location.origin);
  });

  it('nettoie les slashes trailing', () => {
    localStorage.setItem('dt-api-base', 'http://my-server:3000/api///');
    expect(getSocketBaseUrl()).toBe('http://my-server:3000');
  });
});
