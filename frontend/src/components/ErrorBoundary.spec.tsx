import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

vi.mock('../services/pwa/chunkRecovery', () => ({
  isChunkLoadError: vi.fn(),
  recoverFromChunkLoadError: vi.fn(),
}));
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));

import { isChunkLoadError, recoverFromChunkLoadError } from '../services/pwa/chunkRecovery';
import * as Sentry from '@sentry/react';

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // console.error est attendu ici (React logue les erreurs attrapées) — on le
    // laisse tel quel plutôt que de le mocker, pour ne pas masquer une vraie
    // régression de log ailleurs.
  });

  it("détecte un chunk introuvable (page React.lazy() en échec) et déclenche la récupération au lieu d'afficher l'écran d'erreur statique", () => {
    vi.mocked(isChunkLoadError).mockReturnValue(true);

    render(
      <ErrorBoundary>
        <Boom message="Failed to fetch dynamically imported module: /assets/AlertsPage-old.js" />
      </ErrorBoundary>,
    );

    expect(recoverFromChunkLoadError).toHaveBeenCalledTimes(1);
    expect(recoverFromChunkLoadError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch dynamically imported module'),
    );
    // Ne doit PAS envoyer une erreur transitoire de chunk à Sentry (bruit) ni
    // afficher l'écran d'erreur statique dont le bouton "Réessayer" relançait
    // avant ce correctif le même rendu en échec (boucle visuelle).
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('affiche toujours l\'écran d\'erreur statique + Sentry pour une erreur applicative normale', () => {
    vi.mocked(isChunkLoadError).mockReturnValue(false);

    render(
      <ErrorBoundary>
        <Boom message="Cannot read properties of undefined (reading 'foo')" />
      </ErrorBoundary>,
    );

    expect(recoverFromChunkLoadError).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Cannot read properties of undefined/)).toBeInTheDocument();
  });
});
