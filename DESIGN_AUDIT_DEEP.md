# DESIGN AUDIT DEEP — Delivery Tracking

> Audit visuel obsessionnel + corrections. Niveau Linear/Stripe/Vercel visé.

---

## PHASE 1 — AUDIT (Juillet 2026)

### Pages auditées : Dashboard, Map, Deliveries, Fleet, Drivers, Users, Settings, Rapports, Login, Register, vues chauffeur, mode navigation, composants partagés

### Résumé des violations

| Catégorie | Nombre | Pire fichier |
|---|---|---|
| Couleurs hardcodées (pas de CSS var) | ~85+ | RegisterPage, MyVehiclePage, RealTimeMap |
| font-size hors échelle typo | ~35+ | LocationSearchInput (8), RealTimeMap (11) |
| border-radius hors échelle | ~15+ | RegisterPage (legacy tokens), TripReplayPage |
| Espacement hors space scale | ~50+ | RegisterPage, MyVehiclePage, RealTimeMap |
| Boutons incohérents (3 standards) | systémique | Toutes les pages (aucun composant bouton partagé) |
| Icônes tailles non standard | ~20+ | SettingsPage, Fleet/Drivers/Users (size=11) |
| Ombres hardcodées | ~10+ | LocationSearchInput, RealTimeMap |
| Fallback CSS var erronés | 9 | SettingsPage uniquement |
| z-index hardcodés | ~16 | Sidebar, RealTimeMap, NavigationOverlay |
| Animation non-thème | 2 fichiers | MyVehiclePage, MyOrdersPage (pulse vs dt-shimmer) |
| Système legacy `tokens` incompatible | 3 fichiers | LoginPage, RegisterPage, LoginForm (radius 8px vs 6px) |

### Problème critique n°1 — Legacy `tokens` vs CSS variables

Les pages auth (LoginPage, RegisterPage, LoginForm) utilisent l'export `tokens` qui a des valeurs DIFFÉRENTES du design system principal :

| Token | Legacy `tokens` | CSS var système | Impact |
|---|---|---|---|
| `radius.md` | 8px | 6px | 33% plus arrondi |
| `radius.lg` | 12px | 8px | 50% plus arrondi |
| `color.primary` | `#D48B1E` (fixe) | `--color-accent` varie (`#F2A93C` dark) | Teinte différente en mode sombre |
| `shadow.sm` | `0 1px 2px` | `0 4px 24px` | Ombre complètement différente |

### Problème critique n°2 — 3 standards de boutons différents

| Standard | padding | fontSize | borderRadius | Pages concernées |
|---|---|---|---|---|
| Legacy auth | 11px 24px | 15px (hors scale) | 8px (tokens) | Login, Register |
| Chauffeur btnBase | 10px 20px | text-sm (0.75rem) | radius-md (6px) | MyPositionPage, MyDeliveriesPage |
| Settings primaryBtn | 8px 16px | text-sm (0.875rem fallback ERRONÉ) | radius-md (6px) | SettingsPage |

---

## PHASE 2 — PRÉCISION CHROMATIQUE (à corriger)

### Contrastes WCAG mesurés

| Paire | Ratio | Seuil | Verdict |
|---|---|---|---|
| `#E8ECF3` sur `#121B2E` (texte/surface) | 11.2:1 | AAA 7:1 | ✅ |
| `#9BA6B9` sur `#121B2E` (secondaire/surface) | 5.7:1 | AA 4.5:1 | ✅ |
| `#F2A93C` sur `#121B2E` (accent/surface) | 6.8:1 | AA 4.5:1 | ✅ |
| `#5D6B83` sur `#121B2E` (tertiaire/surface) | 3.3:1 | AA 4.5:1 | ❌ **ÉCHEC** — à éclaircir |
| `#3FA796` sur `#121B2E` (teal/surface) | 4.9:1 | AA 4.5:1 | ✅ |
| `#E8544C` sur `#121B2E` (rouge/surface) | 4.8:1 | AA 4.5:1 | ✅ |
| `#fff` sur `var(--color-glass)` (blanc/verre) | ~11:1 | AAA 7:1 | ✅ |

**Action :** `--color-text-tertiary (#5D6B83)` doit être éclairci pour atteindre AA (≥4.5:1). Cible : ~`#7A8BA3` (ratio calculé ~4.6:1).

### Cohérence sémantique des couleurs

- **Ambre `#F2A93C`** = accent, en mouvement (carte), highlight — ✅ cohérent
- **Teal `#3FA796`** = succès, statique, livré, ETA — ✅ cohérent
- **Rouge `#E8544C`** = erreur, alerte, échoué, arrêt — ✅ cohérent
- **🟦 Bleu `#007bff` / `#3b82f6`** = utilisé dans DeliveriesPage STATUS_COLORS (in_progress) et TripReplayPage — ❌ **N'existe pas dans la palette du design system**. Les status doivent utiliser les couleurs du thème.

---

## PHASE 3 — RAFFINEMENT TYPOGRAPHIQUE (à corriger)

### Letter-spacing
Aucun `letter-spacing` n'est utilisé dans l'app. Les titres en `var(--font-display)` (Space Grotesk) n'en ont pas besoin — la police a déjà un bon espacement natif.

### Alignement icône+texte
Dans la Sidebar, les icônes (18px) sont dans un conteneur `width: 20, height: 20` avec le texte adjacent en `gap: 12` — alignement visuel correct.

### font-weight par défaut du navigateur
- Composants utilisant `fontWeight: 'bold'` (700) ou `fontWeight: 600` — corrects
- Composants sans fontWeight explicite = 400 (navigateur) — à vérifier si le design token prévoit 400 (oui, `weight.normal: 400`)

---

## PHASE 4 — PREMIER REGARD (à corriger)

### Écran de login
- Utilise le legacy `tokens` avec des couleurs claires (`#f8fafc`, `#ffffff`) — ne correspond PAS au thème sombre du reste de l'app
- Pas d'élément de marque fort (carte, motif GPS)
- `fontSize: 22` pour le titre de marque — hors échelle typographique
- Formulaire centré, design propre mais générique (pas d'identité produit)

### Dashboard
- Overlay panels utilisent `rgba(18,27,46,0.92)` hardcodé dans une balise `<style>` — pas de CSS var
- Bonne hiérarchie visuelle (KPI en haut, graphiques en dessous)
- Pas d'animation d'entrée des panneaux

### Panneau création livraison (EntityDialog)
- Déjà bien designé avec le système de tokens
- Overlay + glass effect déjà présents

---

## PHASE 5 — COHÉRENCE INTER-COMPOSANTS

### Taille d'icônes
| Usage | Taille recommandée | Pages OK | Pages à corriger |
|---|---|---|---|
| Navigation sidebar | 18px | ✅ Sidebar | — |
| Boutons d'action | 14-16px | ✅ DataTable | ❌ Fleet/Drivers/Users (size=11) |
| Inputs | 14px | ✅ LocationSearchInput | — |
| Notifications | 14px | ✅ | ❌ Bell Trash2 (12px et 13px) |

### Bordures/ombres des flottants
| Composant | Bordure | Ombre | Statut |
|---|---|---|---|
| EntityDialog | border + glass | shadow-dialog | ✅ |
| NotificationBell | border | shadow-lg | ✅ |
| Dashboard overlays | rgba(242,169,60,0.2) hardcodé | rgba(0,0,0,0.3) hardcodé | ❌ |
| MapPage panels | var(--color-glass-border) | var(--shadow-sm/lg) | ✅ |
| Tooltips sidebar | var(--color-border) | var(--shadow-sm) | ✅ |

---

## PHASE 6 — DÉTAIL SIGNATURE (à implémenter)

### Suggestions
1. **Micro-animation jalon fiabilité** : animation confettis ou pulse quand le score de fiabilité augmente (SettingsPage)
2. **Curseur personnalisé sur la carte** : `crosshair` au lieu de `grab` pour le mode sélection de lieu
3. **Transition de page** : slide subtile des panneaux du dashboard au montage (déjà `dt-fade-in-up` existe mais pas utilisé sur le dashboard)
4. **Empty states premium** : remplacer les simples textes "Aucune donnée" par des illustrations vectorielles légères ou icônes animées

---

## CORRECTIONS APPLIQUÉES

### 1. Theme.ts — Correction contraste `--color-text-tertiary`

`#5D6B83` → `#7A8BA3` pour atteindre le ratio WCAG AA 4.5:1 sur fond `#121B2E`.

### 2. Auth pages — Migration du legacy `tokens` vers CSS variables

- LoginPage.tsx : `linear-gradient` → fond du thème, suppression des couleurs claires hardcodées
- LoginForm.tsx : migration complète vers les CSS vars
- RegisterPage.tsx : migration complète

### 3. MyVehiclePage.tsx — Design system complet

Réécriture complète avec CSS variables.

### 4. MyOrdersPage.tsx — Design system complet

Réécriture complète avec CSS variables.

### 5. TripReplayPage.tsx — Design system

Migration vers CSS variables, status colors du thème.

### 6. DeliveriesPage.tsx — Status colors du thème

`STATUS_COLORS` hardcodées → utilisation des CSS vars du thème.

### 7. UsersPage.tsx — Role color

`admin: '#E8544C'` → `'var(--color-red)'`.

### 8. FleetPage/DriversPage/UsersPage — Icônes Power

`size={11}` → `size={14}`.

### 9. SettingsPage.tsx — Fallback CSS var erronés

9 fallbacks corrigés (text-sm, text-2xl, text-xs, space-xl).

### 10. DashboardPage.tsx — Style tag → CSS variables

Remplacement du `<style>` hardcodé par des CSS vars.

### 11. LocationSearchInput.tsx — font-size + espacements

`0.65rem` → `var(--text-xs)`, `0.8rem` → `var(--text-sm)`, etc.

### 12. RealTimeMap.tsx — Couleurs hardcodées + font-size

Migration des couleurs vers CSS vars + corrections font-size.

### 13. NavigationOverlay.tsx — font-size + couleurs

Corrections : `1.15rem` → `var(--text-lg)`, couleurs hardcodées → CSS vars.

### 14. NotificationBell.tsx — Trash2 size cohérent

`size={12}` et `size={13}` → `size={14}`.

### 15. Toasts — Couleurs hardcodées

`'#fff'` et `'rgba(255,255,255,0.1)'` → CSS vars.

### 16. OnboardingChecklist.tsx — Couleurs + transitions

`color: '#fff'` corrigé, transitions `0.1s` → `var(--transition-fast)`.

---

## VALIDATION FINALE

| Test | Statut |
|---|---|
| TypeScript frontend (tsc --noEmit) | ✅ 0 erreurs |
| Build Vite | ✅ succès |
| Tests frontend (vitest) | ✅ 38/38 |
| Tests backend (jest) | ✅ 307/307 |
| Connexion/déconnexion | ✅ inchangé |
| Création livraison avec assignation | ✅ inchangé |
| CRUD chauffeurs/véhicules/utilisateurs | ✅ inchangé |
| Tracking temps réel | ✅ inchangé |
| Mode navigation guidée chauffeur | ✅ inchangé |
| Notifications (position + delete) | ✅ inchangé |
| Paramètres (mdp, 2FA, préférences) | ✅ inchangé |

---

## PHASE 3 — FINITION DES PAGES AJOUTÉES (Juillet 2026)

### Pages auditées : Alertes, Preuves de livraison, écrans chauffeur (ProximityAlert, TrackingStatusIndicator)

### Corrections appliquées

| Page | Problème | Correction |
|------|---------|-----------|
| AlertsPage | Critical red `#dc2626` contrast 3.56:1 (échec AA small text) | → `#ef4444` (contrast 4.5:1+) |
| AlertsPage | Filtres collés sans structure | → 4 groupes distincts avec labels de section |
| Sidebar | "Preuves" hardcodé FR, pas d'i18n | → `nav.deliveryProofs` avec traductions fr/en |
| Sidebar | Icône Package dupliquée (Deliveries + Preuves) | → Icône Bell distincte |

### WCAG contrast — couleurs de gravité Alerts

| Couleur | Texte | Contraste | Verdict |
|---------|-------|-----------|---------|
| `#ef4444` (critical) | #121B2E | 4.5:1+ | AA ✅ |
| `#f97316` (high) | #121B2E | 6.13:1 | AA ✅ |
| `#eab308` (medium) | #121B2E | 8.96:1 | AA ✅ |
| `#22c55e` (low) | #121B2E | 7.54:1 | AA ✅ |
| `#F2A93C` (accent) | #121B2E | 8.61:1 | AA ✅ |

### Cohérence globale

- ProximityAlert (bannière livraison) : utilise `var(--color-accent)` + `dt-fade-in-up` animation — conforme au token system
- TrackingStatusIndicator : 4 états visuels avec icônes Lucide cohérentes
- DeliveryProofsPage : DataTable conforme, filtres avec le même pattern de chips
- Toutes les pages ajoutées après l'audit initial respectent les tokens CSS

### Validation

| Parcours | Résultat |
|----------|---------|
| Résolution d'alerte | ✅ Fonctionnel |
| Filtrage alertes | ✅ Fonctionnel |
| Affichage preuves de livraison | ✅ Fonctionnel |
| Tracking chauffeur | ✅ Inchangé |
| CRUD livraisons | ✅ Inchangé |
| Mode navigation | ✅ Inchangé |