import { useEffect } from 'react';
import { isNativeApp } from '../services/native/nativeAuth';

// Écoute le clavier natif (app Android Capacitor) pour tracer le redimensionnement.
// Objectif : confirmer que le resize se déclenche UNE seule fois après le correctif
// (windowSoftInputMode="adjustPan" côté manifest + resize:'body' côté plugin Keyboard).
// Si on observait deux événements (ou un seul au mauvais moment), le conflit de double
// redimensionnement serait encore là. La valeur keyboardHeight reçue est loggée pour les
// tests manuels sur appareil réel.
export function useKeyboardHandling() {
  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    let listeners: Array<{ remove: () => void }> = [];

    import('@capacitor/keyboard')
      .then(async ({ Keyboard }) => {
        if (cancelled) return;
        const [show, hide] = await Promise.all([
          Keyboard.addListener('keyboardWillShow', (info) => {
            console.debug('[keyboard] willShow keyboardHeight=', info?.keyboardHeight);
          }),
          Keyboard.addListener('keyboardWillHide', () => {
            console.debug('[keyboard] willHide');
          }),
        ]);
        if (cancelled) {
          show.remove();
          hide.remove();
          return;
        }
        listeners = [show, hide];
      })
      .catch((err) => {
        console.debug('[keyboard] plugin unavailable:', err);
      });

    return () => {
      cancelled = true;
      listeners.forEach((l) => l.remove());
    };
  }, []);
}
