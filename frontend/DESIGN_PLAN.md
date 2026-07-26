# DeliveryTrack — Plan de Design Premium

## 1. Identité du produit
SaaS de tracking de flotte de livraison avec anti-fraude GPS, dispatching temps réel,
destiné aux PME de livraison à Madagascar et en Afrique. Les utilisateurs sont des
dispatchers (sur desktop, suivi simultané de plusieurs chauffeurs), des chauffeurs
(sur mobile, navigation et validation livraison), et des gérants d'entreprise
(tableaux de bord consolidés, facturation, alertes carburant).

## 2. Palette renforcée (ink / amber / teal / red)
La palette actuelle est solide (dark froid, ambre chaud pour actions primaires, teal
pour statique/succès, rouge pour alertes). Renforcement :
- **Ombres multi-niveaux** : --shadow-xs à --shadow-2xl, avec variation dark/light
- **Surfaces subtiles** : dégradés très légers sur les cartes, bordures à opacité
  variable (0.08/0.12/0.2) selon la hiérarchie du conteneur
- **Accent ambre glow** : sur les actions primaires (boutons, focus), un halo
  lumineux discret via box-shadow rgba amber

## 3. Boutons et inputs premium
- **Courbes d'easing** : `ease-out` avec cubic-bezier(0.16, 1, 0.3, 1) pour les
  transitions d'entrée/sortie — inertie naturelle, pas de mouvement linéaire
- **Micro-feedback tactile** : scale(0.98) au clic avec ombre qui se resserre,
  transition hover avec translateY(-1px) et ombre renforcée
- **Focus visible élégant** : ring de 2px avec --color-accent + offset, jamais
  d'outline none sans remplacement
- **Disabled distinct** : opacité 0.5 + curseur not-allowed, mais le texte reste
  lisible (pas écrasé par un fond trop transparent)
- **Loading intégré** : spinner avec la couleur du texte du variant, pas de saut
  de layout (width/height stables)

## 4. Signature visuelle : le "radar pulse"
L'indicateur "En mouvement" / "À l'arrêt" / "Alerte" utilise un effet de pulse
radar (cercle concentrique avec opacité dégressive) — directement inspiré des
écrans de tracking GPS automobile. Cohérent avec le teal/ambre déjà présents :
- Moving : pulse ambre (--color-status-moving) avec 2 cercles
- Static : halo teal fixe (--color-status-static) sans animation
- Alert : pulse rouge (--color-status-alert) accéléré

## 5. Autocritique
- Le choix du "radar pulse" n'est pas générique : il est spécifique au tracking de
  véhicules, ce n'est pas un motif décoratif qu'on mettrait sur n'importe quel SaaS.
- Les ombres multi-niveaux sont un standard du design premium, mais leur déclinaison
  dark/light avec des valeurs spécifiques à ce projet (pas une échelle Bootstrap)
  rend le choix difficile à copier-coller d'un autre projet.
- Le focus ambre avec glow est cohérent avec la marque (amber = livraison, chaleur,
  Madagascar) — pas un bleu générique.
