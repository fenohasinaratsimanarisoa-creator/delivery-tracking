import { flushSync } from 'react-dom';
import { useNavigate, type NavigateOptions } from 'react-router-dom';

/**
 * React Router v7 enveloppe TOUTE navigation dans un `startTransition` React 18+
 * (comportement interne, pas configurable par une option de `navigate()`). Une
 * transition est volontairement de PRIORITÉ BASSE et interruptible — normalement
 * pour ne pas bloquer l'UI. Problème réel observé (2026-09-05) : la page Carte
 * temps réel (RealTimeMap.tsx) reçoit des positions GPS en continu (le traceur
 * physique installé aujourd'hui en envoie toutes les 10s) via des mises à jour
 * d'état fréquentes ; chacune interrompt la transition de navigation en cours,
 * qui ne trouve alors jamais de fenêtre assez longue pour se terminer. Résultat
 * observé : cliquer sur un lien de la sidebar EN PARTANT de la Carte temps
 * réel ne fait absolument rien — ni changement d'URL, ni de contenu — tant que
 * la page continue de recevoir des positions, jusqu'à un F5 (qui repart sans
 * transition en attente).
 *
 * `flushSync` force React à traiter la mise à jour de façon SYNCHRONE et
 * ininterruptible avant de rendre la main — la navigation ne peut alors plus
 * être indéfiniment reportée par les mises à jour de la page qu'on quitte.
 * Utiliser ce hook à la place de `useNavigate()` partout où la navigation est
 * déclenchée par un clic utilisateur direct (Sidebar, BottomNav,
 * NotificationBell) : ces clics doivent toujours être urgents, jamais différés.
 */
export function useUrgentNavigate() {
  const navigate = useNavigate();
  return (to: string, options?: NavigateOptions) => {
    flushSync(() => navigate(to, options));
  };
}
