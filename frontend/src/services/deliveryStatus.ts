import type { BadgeVariant } from '../components/Badge';

// Une seule table statut → couleur pour tout le produit : avant, chaque page
// (Livraisons, Mes livraisons, Mes commandes, Détail livraison, Suivi client)
// réimplémentait sa propre version (classes CSS, style inline, color-mix...),
// avec des teintes légèrement différentes d'une page à l'autre pour le MÊME
// statut. Un seul statut ⇔ une seule couleur, partout.
export const DELIVERY_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'orange',
  assigned: 'blue',
  in_progress: 'blue',
  delivered: 'teal',
  failed: 'red',
  cancelled: 'neutral',
};
