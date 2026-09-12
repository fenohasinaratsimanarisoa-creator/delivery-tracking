# DeliveryTrack (LogiTrack) — Système de design actuel

Ce document décrit le système de design **réellement en place**. Une version
précédente de ce fichier décrivait une direction "ambre + radar pulse" qui a
depuis été abandonnée en pratique (voir §4) ; ce qui suit reflète le code tel
qu'il est aujourd'hui, pas un plan à venir.

## 1. Identité du produit
SaaS de tracking de flotte de livraison avec anti-fraude GPS, dispatching temps réel,
destiné aux PME de livraison à Madagascar et en Afrique. Les utilisateurs sont des
dispatchers (sur desktop, suivi simultané de plusieurs chauffeurs), des chauffeurs
(sur mobile, navigation et validation livraison), et des gérants d'entreprise
(tableaux de bord consolidés, facturation, alertes carburant).

## 2. Palette (ink / vert-teal / rouge)
Fond sombre froid (« ink »), un seul accent principal vert-teal (`--color-accent`,
`#6FBF9E` en dark) partagé par les actions primaires ET le statut « succès/en
mouvement », et le rouge (`--color-red`) réservé aux alertes/dangers. Trois modes
sont définis dans `src/styles/theme.ts` : `dark`, `light`, et `field` (variante
haut-contraste pour usage extérieur/chauffeur, activée via
`[data-context="field"]`).

Tokens disponibles (exposés en CSS custom properties par
`ThemeContext.tsx`) :
- **Couleurs** : bg/surface/surfaceAlt/border (+ variantes subtiles), texte
  (primary/secondary/tertiary), accent/teal/red (+ muted/subtle), overlay, glass,
  couleurs de graphique, et un jeu de tokens **sémantiques par statut**
  (`--status-enroute-*`, `--status-idle-*`, `--status-offline-*`,
  `--status-alert-*`, `--status-maintenance-*`, chacun avec base/surface/border/text).
  Les couleurs dark ont des ratios de contraste AA mesurés en commentaire dans
  `theme.ts`.
- **Typographie** : `--font-display`/`--font-body`/`--font-mono`, échelle
  `--text-xs` → `--text-3xl`, poids, line-heights (`--lh-tight/normal/relaxed`).
- **Spacing** : `--space-xs` (4px) → `--space-4xl` (48px).
- **Radius** : `--radius-xs` (2px) → `--radius-2xl` (16px), `--radius-full`.
- **Ombres** : `--shadow-xs` → `--shadow-2xl` (+ `--shadow-glow`/`--shadow-glowDanger`),
  déclinaison dark/light distincte (light = beaucoup plus subtile).
- **Easing/duration** : `--ease-premium`/`--ease-snappy`/`--ease-smooth`,
  `--duration-fast/base/slow`.
- **Z-index** : `--z-base` → `--z-tooltip`.
- Pas encore de tokens de breakpoints partagés — les media queries restent en
  valeurs px par composant (`700px`/`767px`/`480px`...). Piste d'amélioration
  future, non bloquante.

## 3. Composants partagés
`src/components/` fournit une bibliothèque cohérente : `Button`, `Input`,
`Textarea`, `Checkbox`, `Radio`, `Switch`, `Card`, `Badge`, `DataTable` (tri,
pagination, squelette de chargement, état vide, et une vue carte en mobile
intégrés), `Modal` (portail, piège à focus, fermeture Échap), `Toast`, `Tabs`,
`Tooltip`, `Pagination`, `EmptyState`, `ErrorState`, `Skeleton`. Toute nouvelle
page ou tableau doit passer par ces composants plutôt que réinventer sa propre
structure — c'est la règle qui a le plus de valeur pratique ici : la
consolidation menée fin 2026 a justement consisté à aligner les écrans qui
avaient dérivé (Facturation, console Super-Admin, Carburant) sur cette
bibliothèque.

**Boutons/inputs** : easing `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-premium`)
sur les transitions, focus ring visible via `--color-accent` + glow discret
(`--shadow-glow`), état disabled à opacité réduite mais texte lisible, spinner
de chargement sans saut de layout.

**Statuts d'entité** (livraison, tracking, carburant) : une seule table
statut → variante par domaine plutôt qu'une couleur recalculée à chaque écran —
voir `src/services/deliveryStatus.ts` (`DELIVERY_STATUS_VARIANT`) comme
référence du pattern à suivre pour tout nouveau statut.

## 4. Indicateurs de statut : volontairement plats
Contrairement à une direction "radar pulse" envisagée puis abandonnée,
`TrackingStatusIndicator` et `VehicleStatusPill` affichent un point/badge de
couleur **fixe, sans halo ni pulsation** : le libellé + la couleur suffisent.
Le commentaire dans `TrackingStatusIndicator.module.css` est explicite : *« pas
de halo ni de pulsation ambiante »*. Ne pas réintroduire d'animation de pulse
sur ces indicateurs sans une décision produit explicite — ce n'est pas un oubli,
c'est un choix assumé (moins de bruit visuel sur un dashboard consulté en
continu).

## 5. Points d'attention pour toute nouvelle page
- Réutiliser `DataTable`/`Badge`/`Modal`/`Input`/`Toast` avant d'écrire du CSS
  ad hoc — la dérive constatée sur Facturation/Super-Admin/Carburant venait
  systématiquement de tableaux/formulaires/badges réimplémentés à la main.
- Ne jamais coder une couleur/ombre en dur (`#fff`, `rgba(0,0,0,0.X)`) quand un
  token existe : `--color-bg` est la convention pour le texte sur une surface
  accent/rouge pleine (voir `Button.module.css`), `--color-overlay` pour les
  fonds d'overlay/modale.
- Les ombres directionnelles inhabituelles (ex. ombre vers le HAUT d'une barre
  fixée en bas d'écran) n'ont pas d'équivalent exact dans l'échelle
  `--shadow-*` — un `rgba(0,0,0,X)` écrit à la main y reste acceptable, c'est la
  même logique que celle utilisée à l'intérieur des tokens d'ombre eux-mêmes.
