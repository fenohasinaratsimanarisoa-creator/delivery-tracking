# REDESIGN_LOG

Refonte visuelle premium — journal des lots. Voir `DESIGN_AUDIT.md` pour le plan.

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
