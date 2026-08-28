# REDESIGN_LOG

Refonte visuelle premium — journal des lots. Voir `DESIGN_AUDIT.md` pour le plan.

## État

| Lot | Objet | Statut | Branche |
|---|---|---|---|
| 1 | Carte temps réel + panneau véhicule | ✅ fait | `redesign/screen-map` |
| 2 | Nettoyage tokens legacy | ✅ fait | `redesign/lot2-tokens-legacy` |
| 3 | Primitives formulaire | ✅ fait | `redesign/lot3-primitives-form` |
| 5 | Primitives données (Skeleton/EmptyState/ErrorState) | ✅ partiel (DataTable non refondu) | `redesign/lot5-primitives-data` |
| 6 | Chrome (z-index + Sidebar) | ✅ partiel (restyle Sidebar/BottomNav non fait) | `redesign/lot6-chrome` |
| 4 | Primitives overlay (Modal/Drawer/Dropdown/Tabs/Pagination) | ⏳ à faire | — |
| 8–12 | Écrans (Flotte, Carburant, Ops, Admin, Auth) | ⏳ à faire — **nécessite revue navigateur** | — |
| 13 | Passe finale (zoom 200%, 320px, contrastes, textes) | ⏳ à faire — **nécessite navigateur** | — |

Les branches se **chaînent** : `redesign/lot6-chrome` (tip) contient les lots 1→6.
Revue : `git checkout redesign/lot6-chrome && cd frontend && npm run dev`.

Rien n'est mergé sur `main`, rien n'est déployé — conforme à la décision
« déploiement après revue navigateur ».

---

## Lot 1 — Carte temps réel + panneau véhicule

Branche : `redesign/screen-map`
Périmètre validé : style des marqueurs, du panneau flottant et des états
(chargement / vide / hors ligne). **Interdit** : clustering, logique de zoom,
RAF `AnimatedMarker`, abonnements socket, modèle `status` de `vehicleMap.ts`,
nouveau layout de panneau ancré.

### Fichiers touchés

| Fichier | Nature |
|---|---|
| `frontend/src/styles/theme.ts` | +tokens `--status-*` (5 états × base/-surface/-border/-text, 3 palettes) ; +`--transition-{fast,base,slow}` ; fix règle globale `button,a,.clickable` (`--transition-fast` était indéfini → transitions ignorées) |
| `frontend/src/components/VehicleStatusPill.tsx` + `.module.css` + test | **nouveau** — pastille de statut : icône distincte par forme + libellé i18n, jamais couleur seule. `mapVehicleStatus()` : `moving/static/offline` → statut sémantique |
| `frontend/src/services/i18n/locales/{fr,en}.json` | +`vehicleStatus.*`, `map.legend.offline`, `map.panel.*`, `map.searchDriverPlaceholder` (additif) |
| `frontend/src/features/map/RealTimeMap.module.css` | réécrit sur tokens : purge ~13 hex ancienne palette + px hors-grille ; `.dt-marker-offline` (halo figé/pointillé, flèche désaturée) ; popup Leaflet → classes `:global(.dt-popup*)` ; panneau + bandeaux sur tokens |
| `frontend/src/features/map/RealTimeMap.tsx` | chirurgical : `syncVehicleMarker` (statut 3-way + classe offline, RAF inchangé) ; popup DOM identique, style via classes ; panneau (en-tête plaque > chauffeur, `VehicleStatusPill`, i18n, dédup ligne « Statut », retrait ligne « Véhicule ID », emoji → icône) ; avertissement hors-ligne ≠ périmé ; liste de recherche interne (pill + i18n) |
| `frontend/src/pages/MapPage.module.css` | réécrit sur tokens : suppression glassmorphism (gradients + `backdrop-filter` ×5) et animations décoratives ; purge ~42 hex + `var(--text-2xs)` inexistant |
| `frontend/src/pages/MapPage.tsx` | boutons Filtres/Couches inertes retirés ; légende → 3 `VehicleStatusPill` (+ hors ligne) ; `✕` → icône `X` |
| `frontend/src/pages/__tests__/MapPage.test.tsx` | aligné (boutons retirés, libellés de légende) |

### Décisions de design

- **Accent unique vert `#6FBF9E`** conservé ; l'ambre `#F2A93C` (ancien 2ᵉ accent
  de marque) ne survit que comme `--color-warning` / `--status-maintenance`.
- **5 teintes de statut distinctes** : en route = vert (accent), à l'arrêt =
  bleu-ardoise, hors ligne = gris désaturé, alerte = rouge, maintenance = ambre.
  → « à l'arrêt » n'est plus vert (ne se confond plus avec « en route »).
- **Hors ligne sur le marqueur** : halo figé + pointillé + flèche en niveaux de
  gris + `NavigationOff` dans le panneau. Trois indices non-couleur (forme du
  halo, désaturation, icône du pill), plus le libellé.
- **Panneau** : hiérarchie plaque (mono, prominent) > chauffeur > statut (pill) >
  données. Plaque résolue en lecture seule depuis `allDrivers` (le flux
  `VehicleData` ne la porte pas — pas de modif de `vehicleMap.ts`).
- Retiré du panneau : ligne « Véhicule ID » (UUID tronqué, inutile à un
  opérateur) ; 2ᵉ ligne « Statut » (doublon) → devient « Livraison ».
- Renommé : « Confiance Kalman » → « Fiabilité du fix » ; « Direction » → « Cap ».
- **Glassmorphism supprimé** de la carte (cohérent avec `theme.ts` : *glass =
  surface opaque*). Sur un écran laissé ouvert toute la journée, `backdrop-filter:
  blur` ×5 + animations d'entrée qui rejouent à chaque navigation = coût GPU et
  bruit visuel sans bénéfice.
- Boutons Filtres/Couches de `MapPage` : **retirés** (non fonctionnels). Le
  sélecteur de fond de carte natif Leaflet (bas-gauche) reste.

### Vérifié

- `tsc -b --noEmit` : OK
- `eslint` (fichiers touchés) : OK
- `vitest run` — carte + composants (`VehicleStatusPill`, `MapPage`) : OK
  (+6 tests ajoutés : VehicleStatusPill ; MapPage.test aligné)
- `vite build` : OK (warnings `:global {}` pré-existants, 8 fichiers CSS
  concernés, non liés au lot)
- Suite complète `vitest run` : **241 tests / 29 fichiers, tous OK**
- `eslint .` (repo front entier) : OK (0)

### Non vérifié / limites

- **Rendu visuel réel non vérifié** : pas de navigateur ni Leaflet dans
  l'environnement de test (jsdom). `RealTimeMap` n'a pas de test unitaire
  (seuls `vehicleMap` / `animationTiming` / `markerIcons` / `tileProviders`,
  logique pure, inchangés).
- **Popup Leaflet** : style porté sur tokens, mais libellés **toujours en
  français en dur** (i18n = lot ultérieur : threader `t` dans le composant
  RAF `AnimatedMarker` est le point risqué, hors périmètre « ne touche pas à
  la logique temps réel »).
- Panneau latéral **ancré** (liste véhicules persistante et scannable) : non
  fait — proposition séparée, comme convenu.
- Fusion des deux barres de recherche (MapPage + interne RealTimeMap) : hors
  périmètre.
- `mergePositionUpdate` ne repasse jamais `status:'offline'` pendant la
  session (seul le bootstrap le fait) → un véhicule qui décroche en cours de
  session garde son dernier marqueur jusqu'au reload. Comportement existant,
  non corrigé (= logique temps réel).

### En attente de décision

- Rien de bloquant. Prochain lot proposé : Lot 2 (nettoyage legacy tokens) ou
  directement Lot 8 (Flotte + fiche véhicule) — à ton choix.

---

## Lot 2 — Nettoyage tokens legacy

Branche : `redesign/lot2-tokens-legacy`

- `theme.ts` : suppression des exports `tokens` et `keyframes` (−77 lignes de
  code mort, aucun import dans `src/` — vérifié). Ils portaient des valeurs
  DIVERGENTES du système moderne (radius, timings, palette, `dt-fade-in-up`),
  source de confusion.
- `dt-shimmer` local à 10 CSS modules : reporté au Lot 5 (le composant
  `Skeleton` les rendra obsolètes).

Vérifié : tsc, eslint, tests (auth + composants).

---

## Lot 3 — Primitives formulaire

Branche : `redesign/lot3-primitives-form`

| Composant | Changement |
|---|---|
| `Button` | `type="button"` par défaut (submit accidentel dans un `<form>` = bug latent ; submits explicites vérifiés) · libellé `sizeSm` 10px → `--text-sm` · `danger` passe en **plein** (poids cohérent) · fallbacks ancienne palette purgés · `aria-busy` · `className` fusionné (n'écrase plus les styles) |
| `Input` | `id` via `useId()` (collisions / accents corrigés) · `aria-invalid` + `aria-describedby` · erreur `role="alert"` · padding icônes en CSS · états `read-only`/`disabled` |
| `Badge` | variantes **sémantiques** `success/warning/danger/info` (couleurs brutes → alias dépréciés) |
| `Textarea`, `Checkbox` (+ indeterminate), `Radio`, `Switch` (role=switch), `Tooltip` (CSS-only, survol + focus + Échap) | **nouveaux**, additifs, non encore adoptés |

Décision : `danger` en bouton plein rouge. Visible partout où des actions
destructives existent — **à confirmer en revue navigateur**.

Vérifié : tsc, eslint, +34 tests. `<Button>` : couvert par les tests des forms
auth (submit toujours OK).

---

## Lot 5 — Primitives données (partiel)

Branche : `redesign/lot5-primitives-data`

- `Skeleton` (text multi-lignes / block / circle), `EmptyState`, `ErrorState`
  (role=alert + Réessayer) — additifs, remplaceront les implémentations ad hoc.
- `formatRelativeTime()` dans `services/i18n/formatDate.ts` : « il y a X min »
  (Intl.RelativeTimeFormat), bascule date absolue > 24 h.
- `common.errorTitle` / `common.retry` (fr + en).

**Non fait** : refonte de `DataTable` (en-tête collant, alignement par type,
`tabular-nums`, `:hover` CSS au lieu de JS, skeleton à la forme du tableau).
`DataTable` est utilisé par ~8 écrans → à faire avec revue navigateur, pas en
aveugle. Les primitives dont il a besoin (`Skeleton`, `EmptyState`) sont prêtes.

Vérifié : tsc, eslint, +22 tests.

---

## Lot 6 — Chrome (partiel)

Branche : `redesign/lot6-chrome`

- `theme.ts` : échelle `--z-*` (base → tooltip). Barème unique pour remplacer
  les ~22 valeurs z-index arbitraires et les 92 `!important`. `Tooltip` câblé.
- `Sidebar` : préférence « replier » **persistée** (localStorage) — avant, un
  `useEffect` la remettait à false à chaque navigation.

**Non fait** : restyle visuel Sidebar (contraste, largeur) + BottomNav +
migration `--z-*` / suppression des `!important` page par page → revue navigateur.

Vérifié : tsc, eslint.

---

## Reste à faire (nécessite la boucle de revue navigateur)

1. **Lot 4** — Modal générique (portal + focus-trap + scroll-lock), Drawer,
   Dropdown, Pagination autonome, Tabs ; refonte de `ConfirmDialog` /
   `EntityDialog` par-dessus (sans changer leurs props).
2. **`DataTable`** (Lot 5 restant).
3. **Lots 8–12 — écrans** : migration hex→token + structure + 3 états par
   écran, un écran à la fois, chacun vérifié dans le navigateur.
   Fichiers lourds à traiter par petits commits (CSS d'abord) :
   `FuelPage.tsx` (1831 l.), `RealTimeMap.tsx` déjà fait, `DeliveriesPage.tsx`
   (955 l.).
   > Rappel mission : « aucun find-replace global sur des classes ou des
   > couleurs » — le même hex sert à des sémantiques différentes selon les
   > fichiers, la migration ne peut pas être automatisée en bloc.
4. **Lot 13** — passe finale (zoom 200 %, viewport 320 px, contrastes mesurés,
   relecture des textes d'UI, purge des derniers hex/`!important`/keyframes
   mortes).

---

## Lot 4 — Primitives overlay (partiel)

Branche : `redesign/lot4-primitives-overlay`

| Composant | État |
|---|---|
| `Modal` | **nouveau** — portal, verrou de scroll body, piège à focus (Tab/Shift+Tab), Échap, clic sur le fond, restauration du focus, `role=dialog` + `aria-modal`/`labelledby`, `--z-modal`, feuille du bas < 480px |
| `Pagination` | **nouveau** — « X–Y sur Z » + n° de page, chevrons lucide, `tabular-nums`, cibles 44px |
| `Tabs` | **nouveau** — `role=tablist`, clavier ←/→/Home/End, roving tabindex |
| `ConfirmDialog` | **refondu sur `Modal`** (mêmes props). Gagne portal + focus-trap + scroll-lock. Focus initial → « Annuler » (défensif). `ConfirmDialog.module.css` supprimé. |
| `EntityDialog` | **non fait** — injecte son propre CSS d'input, dépend de `useEntityForm`, testé par `FuelPage.test` → à refondre avec revue navigateur |
| `Drawer`, `Dropdown` | **non faits** |

+5 tests. tsc + eslint OK. Consommateurs de `ConfirmDialog` (FuelPage,
DeliveriesPage, FleetPage, UsersPage) : tests verts.

---

## Lot 5b — DataTable

Branche : `redesign/lot5b-datatable` (**tip de la chaîne — contient tous les lots**)

Refonte style + structure, **comportement de tri INCHANGÉ** :
- `<thead>` réellement collant + colonnes sélection/actions gelées via classes
  (fin des z-index inline arbitraires 1/2/3)
- `Column.align?` (`left`/`right`/`center`) — `right` ajoute `tabular-nums`.
  Additif (colonnes sans `align` = inchangées).
- hover de ligne : CSS `:hover` au lieu de handlers JS `onMouseEnter/Leave`
- chargement : `<Skeleton>` à la forme du tableau
- vide : `<EmptyState>` + icône `Inbox` (l'icône `Pencil` était un contre-sens)
- pagination : `<Pagination>` (au lieu des glyphes `←/→` + `pageBtnStyle` inline)
- tri : chevrons lucide + `aria-sort` (au lieu des `▲▼` unicode)

API `Column<T>` / `Props<T>` inchangée sauf `align?`. 77 tests
pages/composants verts. `eslint .` + `vite build` OK.

---

## Où en est-on

**Branche à réviser : `redesign/lot5b-datatable`** (13 commits, linéaire depuis
`main`). Elle contient les lots 1, 2, 3, 4 (partiel), 5, 5b, 6 (partiel).

```
git checkout redesign/lot5b-datatable && cd frontend && npm run dev
```

Rien n'est mergé sur `main`, rien n'est déployé.

Fait (fondations + primitives, vérifiables au build/tests mais **PAS visuellement**
dans cet environnement) :
- Tokens : `--status-*`, `--z-*`, `--transition-*` (+ fix), purge des exports
  legacy.
- Primitives : `Button` `Input` `Badge` (sémantique) `Textarea` `Checkbox`
  `Radio` `Switch` `Tooltip` `Modal` `Pagination` `Tabs` `Skeleton` `EmptyState`
  `ErrorState` `VehicleStatusPill` ; `ConfirmDialog` sur `Modal` ; `DataTable`
  refondu ; `formatRelativeTime`.
- Écran carte (Lot 1) entièrement fait.

À faire — **nécessite la boucle de revue navigateur** (un écran à la fois) :
- `EntityDialog` sur `Modal` ; `Drawer` / `Dropdown`.
- Lots 8–12 : Flotte, Carburant, Ops, Admin, Auth — migration hex→token +
  adoption des primitives + 3 états par écran.
- Lot 13 : passe finale (zoom 200 %, 320 px, contrastes, textes, purge finale).

---

## Migration palette (transversale, hors lots)

Branche : `redesign/full` (intègre tous les lots)

- **1107 → 43 occurrences hex** sur 54 CSS modules. Migration **fichier par
  fichier** (pas de find-replace global) : chaque hex de l'ancienne palette a
  un rôle sémantique unique, vérifié par analyse du contexte (property) :
  surface / surface-alt / surface-hover / bg / text / text-secondary /
  text-tertiary / accent / teal / red / blue / warning + familles.
- Fallbacks morts `var(--token, #hex)` retirés ; alias legacy sans définition
  (`--color-primary/-error/-card/-accent-strong`…) remappés sur les vrais
  tokens ; `var(--x, var(--x))` redondants (903, effet de bord du 1er passage)
  collapsés.
- **Restant (43)** : `#fff` sur badges colorés (légitime), `#4285f4` (bleu de
  marque Google, volontaire), quelques dégradés d'avatar → Lot 13.
- **Non fait** : les `rgba()` de teinte de l'ancienne palette (~400,
  `rgba(242,169,60,X)` etc.) — subtiles, proches des nouvelles teintes, à
  migrer vers `color-mix` / `*-muted` lors de la passe navigateur.

tsc + eslint . + vite build + **263 tests** OK.

---

## Déploiement — FAIT (2026-08-29)

`redesign/full` (17 commits) mergée en fast-forward sur `main` (`8bce968`),
poussée, déployée sur Contabo via `deploy-contabo.sh` :
- build `--no-cache` backend/worker/frontend OK
- health-gate : backend/frontend `healthy`, `/health` = ok (db/redis/queue)
- `prisma migrate deploy` : « No pending migrations » (refonte front only)
- `déploiement OK — commit 8bce968 en production`, pas de rollback
- vérif : `https://169-58-237-88.sslip.io` 200 · `/api/health` 200 · Traccar 200 ·
  bundle CSS = `--color-accent` (ancienne palette `#f2a93c` : 1 résiduel) ·
  logs backend/frontend sans erreur depuis le déploiement

⚠️ **Rendu visuel non vérifié** (pas de navigateur dans l'environnement de
travail) : à contrôler en prod immédiatement, écran par écran. Rollback :
`git revert` du merge + redéploiement, ou retour au commit précédent.

Ce qui reste (passe navigateur, écran par écran) : structure/hiérarchie/densité
par écran (Lots 8–12), `rgba()` de teinte, grille 4 px, `!important` (92),
keyframes décoratives, `EntityDialog` sur Modal, `Drawer`/`Dropdown`,
Lot 13 (zoom 200 %, 320 px, contrastes mesurés, relecture des textes).

---

## Vérification visuelle (2026-08-29) — Chrome headless

`google-chrome --headless --screenshot` contre le serveur de mocks
(`vite.mock.config.ts`, port 5199) + un **baseline pré-refonte** (worktree sur
`3fa79e0`, port 5198) pour distinguer régression et bug pré-existant.
Harnais : `scratchpad/shoot.sh` (JWT non signé en `?token=`, 14 routes).

### Résultat : aucune régression introduite par la refonte

| Constat | Verdict |
|---|---|
| Chevauchement titre / barre de recherche sur `/dashboard` | **pré-existant** (identique au baseline) |
| `/deliveries` : crash `toLocaleDateString` | **pré-existant** — corrigé (voir ci-dessous) |
| Bandeau cookies `{privacyLink}` littéral | **pré-existant** — corrigé |
| Palette, DataTable, primitives, carte | cohérents, aucun écart visuel non voulu |

### 3 bugs réels corrigés (commit `d7716bb`)

1. **`formatDate` & co. plantaient sur une date nulle** → l'ErrorBoundary
   remplaçait TOUT l'écran par une page d'erreur. Une seule cellule sans date
   faisait tomber `/deliveries` entièrement, alors que `scheduledDate` /
   `completedAt` / `paidAt` sont nullables au schéma. Helper `toValidDate()` :
   rend `—`, ne plante jamais. Couvre les 7 formatters.
2. **Bandeau cookies** (page d'accueil **publique**) : `<Trans>` recevait des
   placeholders `{x}` que i18next n'interpole pas → tags nommés + `components`.
3. **FuelPage** : état d'erreur = `<p>` rouge nu → `<ErrorState>` (icône, titre,
   description, bouton Réessayer câblé sur `refetch`).

### Limites du harnais

Les mocks ne couvrent pas tous les endpoints (carburant, rapports) : ces écrans
s'affichent en état d'erreur — ce qui a justement permis de vérifier l'état
d'erreur. `/map` ne se capture pas (Leaflet + socket en headless). Le rendu
mobile (320 px), le zoom 200 % et les contrastes mesurés restent à vérifier.
