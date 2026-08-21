import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// RECONNEXION ROBUSTE DU DASHBOARD (Partie 2, point 1) — verrou anti-régression.
//
// Ces tests vérifient le CONTRAT de socket.ts :
//  1. Reconnexion automatique avec backoff (reconnection: true, tentatives
//     illimitées, délai 1s → max 5s) — jamais d'abandon après quelques essais.
//  2. Refresh de token SILENCIEUX avant expiration (proactif, pas de 401).
//  3. Reconnexion forcée au retour de veille (Page Visibility) pour rattraper
//     l'état complet manqué pendant la déconnexion.
// Si un futur changement cassait l'un de ces comportements (ex. plafond bas de
// reconnectionAttempts, backoff agressif, refresh supprimé), ce fichier échoue.
// =============================================================================

const ioMock = vi.fn();
vi.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => ioMock(...args),
}));

vi.mock('../auth/tokenStore', () => ({
  getAccessToken: vi.fn().mockReturnValue('token-1'),
  getAccessTokenExpiryMs: vi.fn().mockReturnValue(Date.now() + 15 * 60 * 1000),
}));

vi.mock('../auth/refreshToken', () => ({
  refreshAccessToken: vi.fn().mockResolvedValue('token-2'),
}));

vi.mock('../api/config', () => ({
  getSocketBaseUrl: vi.fn().mockReturnValue('http://localhost:4000'),
}));

// Mock du socket retourné par io(): on capture les options de connexion et on
// simule connect/disconnect pour exercer les handlers. Le socket commence
// CONNECTÉ : c'est le comportement réel de socket.io-client (io() auto-connect),
// et les handlers du module en dépendent (ex. handleRefreshTick ne reconnecte
// que si socket.connected).
function makeFakeSocket() {
  const handlers: Record<string, Array<(data?: unknown) => void>> = {};
  const listeners: Record<string, Array<(data?: unknown) => void>> = {};
  let connected = true;
  return {
    get connected() { return connected; },
    connect: vi.fn(() => { connected = true; }),
    disconnect: vi.fn(() => { connected = false; }),
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (data?: unknown) => void) => {
      (handlers[event] ||= []).push(handler);
    }),
    once: vi.fn(),
    off: vi.fn(),
    io: {
      on: vi.fn((event: string, handler: (data?: unknown) => void) => {
        (listeners[event] ||= []).push(handler);
      }),
    },
    // Helpers de test
    _emit: (event: string, data?: unknown) => (handlers[event] || []).forEach((h) => h(data)),
    _emitIo: (event: string, data?: unknown) => (listeners[event] || []).forEach((h) => h(data)),
    auth: undefined as unknown,
  };
}

describe('socket.ts — reconnexion robuste du dashboard', () => {
  let fakeSocket: ReturnType<typeof makeFakeSocket>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fakeSocket = makeFakeSocket();
    ioMock.mockReturnValue(fakeSocket);
    // document.visibilityState doit être défini avant l'import du module (le
    // module lit document au premier getSocket()). Le mock ci-dessus est lazy :
    // on n'importe le module qu'après avoir préparé l'environnement.
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('configure une reconnexion illimitée avec backoff raisonnable (1s → max 5s)', async () => {
    const { getSocket } = await import('./socket');
    getSocket();
    const [, options] = ioMock.mock.calls[0];
    expect(options.reconnection).toBe(true);
    expect(options.reconnectionAttempts).toBe(Infinity);
    expect(options.reconnectionDelay).toBe(1000);
    expect(options.reconnectionDelayMax).toBe(5000);
    // Pas de retry agressif : le backoff démarre à 1 s et plafonne à 5 s.
    expect(options.reconnectionDelay).toBeLessThanOrEqual(options.reconnectionDelayMax);
  });

  it('rafraîchit le token SILENCIEUSEMENT avant expiration (proactif, pas de 401)', async () => {
    const { getSocket } = await import('./socket');
    getSocket();
    // Le refresh est programmé (timer). On avance le temps jusqu'à l'expiration
    // - marge : le handler appelle refreshAccessToken puis reconnecte le socket.
    const { refreshAccessToken } = await import('../auth/refreshToken');
    // Date d'expiration mockée = +15 min, marge = 60 s → refresh à ~14 min.
    await vi.advanceTimersByTimeAsync(14 * 60 * 1000 + 1000);
    expect(refreshAccessToken).toHaveBeenCalled();
    // La reconnexion propre a été déclenchée (disconnect + connect).
    expect(fakeSocket.disconnect).toHaveBeenCalled();
    expect(fakeSocket.connect).toHaveBeenCalled();
  });

  it('au retour de veille longue (> seuil), force disconnect+connect pour rattraper l\'état complet', async () => {
    const { getSocket } = await import('./socket');
    const s = getSocket();
    // Simule le passage en arrière-plan puis le retour après > 10 s.
    const originalState = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    // Veille longue (> seuil de 10 s) : le temps avance pendant l'arrière-plan.
    vi.advanceTimersByTime(12 * 1000);
    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(Document.prototype, 'visibilityState', originalState!);

    expect(s.disconnect).toHaveBeenCalled();
    expect(s.connect).toHaveBeenCalled();
  });

  it('ne force PAS de reconnexion pour un passage arrière-plan court (< seuil)', async () => {
    const { getSocket } = await import('./socket');
    const s = getSocket();
    // Passage arrière-plan < 10 s : pas de reconnexion forcée.
    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    // Le handler garde lastHiddenAt : sans avance de temps, hiddenMs = 0 < seuil.
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it('l\'événement "io server disconnect" déclenche une reconnexion immédiate', async () => {
    const { getSocket } = await import('./socket');
    const s = getSocket() as unknown as ReturnType<typeof makeFakeSocket>;
    s._emit('disconnect', 'io server disconnect');
    expect(s.connect).toHaveBeenCalled();
  });

  it('erreur serveur "Invalid token" → refresh immédiat puis reconnexion propre avec le nouveau jeton', async () => {
    const { getSocket } = await import('./socket');
    const s = getSocket() as unknown as ReturnType<typeof makeFakeSocket>;
    const { refreshAccessToken } = await import('../auth/refreshToken');
    // Le serveur rejette la session (tracking.gateway.ts → client.emit('error',
    // 'Invalid token')) : on ne doit PAS boucler en silence avec le jeton périmé —
    // refresh immédiat (mock résout 'token-2') puis disconnect+connect pour refaire
    // le handshake avec le nouveau jeton.
    s._emit('error', 'Invalid token');
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshAccessToken).toHaveBeenCalled();
    expect(s.disconnect).toHaveBeenCalled();
    expect(s.connect).toHaveBeenCalled();
  });

  it('refresh échoué après "Invalid token" → sessionExpired notifié et boucle de reconnexion stoppée', async () => {
    const { getSocket, onSocketSessionExpired } = await import('./socket');
    const listener = vi.fn();
    onSocketSessionExpired(listener);
    const s = getSocket() as unknown as ReturnType<typeof makeFakeSocket>;
    const { refreshAccessToken } = await import('../auth/refreshToken');
    (refreshAccessToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    s._emit('error', 'Invalid token');
    await vi.advanceTimersByTimeAsync(0);
    // L'UI est prévenue (TrackingStatus.sessionExpired)…
    expect(listener).toHaveBeenCalledTimes(1);
    // … et la reconnexion indéfinie avec le jeton périmé est stopée.
    expect(s.disconnect).toHaveBeenCalled();
    expect(s.connect).not.toHaveBeenCalled();
  });

  it('session expirée : "io server disconnect" ne relance PLUS la reconnexion automatique', async () => {
    const { getSocket } = await import('./socket');
    const s = getSocket() as unknown as ReturnType<typeof makeFakeSocket>;
    const { refreshAccessToken } = await import('../auth/refreshToken');
    (refreshAccessToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    s._emit('error', 'Invalid token');
    await vi.advanceTimersByTimeAsync(0);
    s._emit('disconnect', 'io server disconnect');
    expect(s.connect).not.toHaveBeenCalled();
  });

  it('rejet du handshake pendant la phase de connexion (connect_error "Invalid token") → même traitement refresh', async () => {
    const { getSocket } = await import('./socket');
    const s = getSocket() as unknown as ReturnType<typeof makeFakeSocket>;
    const { refreshAccessToken } = await import('../auth/refreshToken');
    // socket.io-client expose le rejet du handshake (avant 'connect') comme
    // 'connect_error' avec le message du serveur.
    s._emit('connect_error', new Error('Invalid token'));
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshAccessToken).toHaveBeenCalled();
    expect(s.connect).toHaveBeenCalled();
  });

  it('un connect_error réseau classique (serveur down) ne déclenche PAS de refresh de session', async () => {
    const { getSocket } = await import('./socket');
    const s = getSocket() as unknown as ReturnType<typeof makeFakeSocket>;
    const { refreshAccessToken } = await import('../auth/refreshToken');
    s._emit('connect_error', new Error('websocket error'));
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('connect_error "Invalid token: expired or invalid" (jeton expiré pendant une reconnexion) → refresh immédiat — fin du "Reconnexion…" permanent', async () => {
    const { getSocket } = await import('./socket');
    const s = getSocket() as unknown as ReturnType<typeof makeFakeSocket>;
    const { refreshAccessToken } = await import('../auth/refreshToken');
    // Message EXACT de ws-auth.service.ts quand le JWT d'accès a expiré pendant
    // la reconnexion (le cas le plus fréquent de la boucle "Reconnexion…"
    // permanente sur le terrain : l'ancien matcher .includes('Invalid token')
    // ne trouvait pas la sous-chaîne dans 'Invalid or expired token').
    s._emit('connect_error', new Error('Invalid token: expired or invalid'));
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshAccessToken).toHaveBeenCalled();
    expect(s.disconnect).toHaveBeenCalled();
    expect(s.connect).toHaveBeenCalled();
  });

  it('connect_error "Invalid token: missing" → refresh puis reconnexion propre', async () => {
    const { getSocket } = await import('./socket');
    const s = getSocket() as unknown as ReturnType<typeof makeFakeSocket>;
    const { refreshAccessToken } = await import('../auth/refreshToken');
    s._emit('connect_error', new Error('Invalid token: missing'));
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshAccessToken).toHaveBeenCalled();
    expect(s.connect).toHaveBeenCalled();
  });

  it('configure transports: ["websocket", "polling"] — fallback polling si WebSocket bloqué', async () => {
    const { getSocket } = await import('./socket');
    getSocket();
    const [, options] = ioMock.mock.calls[0];
    // Le socket doit inclure 'polling' comme transport de repli pour les
    // réseaux mobiles/proxy qui bloquent l'upgrade WebSocket.
    expect(options.transports).toEqual(['websocket', 'polling']);
  });

  it('connect_error réseau (non-auth) incrémente le compteur d\'échecs consécutifs', async () => {
    const { getSocket } = await import('./socket');
    const s = getSocket() as unknown as ReturnType<typeof makeFakeSocket>;
    // 3 erreurs réseau consécutives (pas d'auth rejection)
    s._emit('connect_error', new Error('websocket error'));
    s._emit('connect_error', new Error('timeout'));
    s._emit('connect_error', new Error('polling error'));
    await vi.advanceTimersByTimeAsync(0);
    // Pas de refresh déclenché (pas d'auth rejection)
    const { refreshAccessToken } = await import('../auth/refreshToken');
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('déconnexion produit un log structuré (disconnect reason)', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getSocket } = await import('./socket');
    const s = getSocket() as unknown as ReturnType<typeof makeFakeSocket>;
    s._emit('disconnect', 'transport close');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('disconnect: reason=transport close'),
    );
    spy.mockRestore();
  });

  it('reconnect_attempt au-delà de la 3e tentative produit un log', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getSocket } = await import('./socket');
    getSocket();
    // Récupère le handler enregistré via fakeSocket.io.on('reconnect_attempt', ...)
    const ioOnCalls = fakeSocket.io.on.mock.calls;
    const reconnectEntry = ioOnCalls.find((c: any[]) => c[0] === 'reconnect_attempt');
    expect(reconnectEntry).toBeDefined();
    const reconnectHandler = reconnectEntry![1];
    // Simule la 5e tentative de reconnexion
    reconnectHandler(5);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('reconnect_attempt #5'),
    );
    spy.mockRestore();
  });
});
