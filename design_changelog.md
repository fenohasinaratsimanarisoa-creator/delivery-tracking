# Design Changelog — Refonte « DelivTrack Pro »

Résumé des choix faits et pourquoi, pour validation rapide. **UI uniquement** : aucune logique métier modifiée, le logo/identité de marque restent inchangés.

## 1. Palette — piste B « Route » (vert forêt désaturé) ✅ retenue

| Rôle | Light | Dark (admin) | Field (chauffeur) |
|---|---|---|---|
| Fond | `#F6F7F9` | `#101216` | `#F4F5F6` |
| Surface | `#FFFFFF` | `#171A1F` | `#FFFFFF` |
| Texte principal | `#16181D` | `#EDEEF0` | `#14171B` |
| **Accent unique** | `#2F6B4F` | `#6FBF9E` | `#275A43` |
| Succès (statuts) | `#2E7D5B` | `#4CAF87` | `#256B52` |
| Danger (statuts) | `#B4443B` | `#E0756C` | `#B03A32` |
| Alerte (warning) | `#B7791F` | `#D9A441` | `#9A6314` |

- **UNE seule couleur d'accent** (avant : ambre + teal + cyan + bleu startup + violet = 5 couleurs concurrentes). L'accent est réservé aux actions/éléments actifs ; les couleurs sémantiques ne servent qu'aux **statuts fonctionnels** (livraison, carburant, GPS).
- Le bleu `in_progress` était `#3B82F6` (bleu startup interdit) → **ardoise désaturée** `#4A6B8A`/`#8AA8C7`.
- Tous les hex de l'ancienne palette ambre/teal startup retirés des tokens ; les quelques fallbacks restants dans les CSS modules sont du code mort (la variable est toujours définie).

## 2. Typographie

- **Display : IBM Plex Sans (600/700)** — caractère industriel discret, remplace Space Grotesk (trop « friendly rounded »). Chargée dans `index.html`.
- **Corps : Inter** (inchangé).
- **Données chiffrées : JetBrains Mono conservé** (immatriculations, GPS, montants, dates, compteurs KPI) — rôle central du produit, déjà en place.
- Densité assumée : tableaux denses, headers uppercase letter-spacing, skeletons shimmer sur `--color-skeleton`.

## 3. Anti-patterns retirés (brief)

| Interdit | Avant | Après |
|---|---|---|
| Glassmorphism | `backdrop-filter: blur()` sur panneaux par-dessus la carte | **Panneaux opaques** (tokens `--color-glass` = surfaces pleines) + ombres plates `0 1px 2px`/`0 4px 12px` |
| Dégradés « hero » | boutons/brandIcon en `linear-gradient`, shine animé | **Couleurs plates** (accent + hover), shine supprimé |
| Glow / halos décoratifs | `shadow-glow` sur hover, pulses infinis, halo ambre | Retirés ; halo des marqueurs piloté par `color-mix()` sur les tokens de statut |
| Emojis dans l'UI | 🚗⚡📍📦💳… (carte, navigation, billing, notes) | **Icônes lucide** (Truck, Package, CreditCard…) + libellés texte |
| Ombres flottantes exagérées | `translateY(-2px)` + glow au hover | Hover = changement de fond/bordure uniquement |
| Radius « friendly » | 16px partout | 6 boutons / 8 cartes / 12 dialog |

## 4. Les deux contextes restent distincts

- **Control room** (admin/dispatcher) : densité, sidebar fixe, **dark/light fonctionnel**.
- **Field** (driver/client, `data-context="field"`) : **clair uniquement**, fort contraste, CTA tactile ≥44px, **un seul CTA principal par écran** (Prendre en charge → Livrer/Échouer), alertes batterie/GPS/hors-ligne opaques. Déjà structuré ainsi — la refonte aligne sa palette sur la piste « Route ».

## 5. Écrans traités (ordre de priorité)

1. **Dashboard** — panneaux opaques, KPI flat, chip titre sans gradient/glow, charts sur tokens.
2. **Carte temps réel** — marqueurs véhicule = SVG truck (plus d'emoji), popups opaques, halos via `color-mix`, destination plate.
3. **Tableaux** (livraisons/véhicules/chauffeurs) — DataTable dense déjà token-driven, headers sticky, statuts désaturés.
4. **App chauffeur** — liste livraisons, écran actif, navigation pas-à-pas (icônes lucide), bannières d'alerte.
5. **Formulaires** — EntityDialog, Input, LocationSearchInput, boutons (hover plat, focus ring conservé).
6. **Facturation** — cartes plans avec icônes lucide, prix en mono, méthodes de paiement (Stripe/MVola/Orange Money) en icônes.

## 6. À trancher / suivis possibles

- **Marque** : le wordmark affiché reste « LogiTrack » (sidebar + `<title>`) alors que le produit s'appelle DelivTrack — **inchangé volontairement** (identité hors périmètre). À harmoniser séparément si souhaité.
- **Auth pages** : les fonds décoratifs (`LoginLayout`/`VisualPanel` : blobs radiaux ambre/bleu hérités) et quelques dégradés restent hors périmètre — à nettoyer dans une passe dédiée si vous voulez l'homogénéité totale (les CTA de connexion, eux, sont déjà plats).
- **Fallbacks CSS** : les chaînes `'Space Grotesk'` et hex ambre en fallback dans les modules CSS sont du code mort (jamais atteintes) — nettoyage cosmétique possible plus tard.

## 7. Vérifications

- `npx tsc --noEmit` : OK
- `npm run build` : OK
- `npx vitest run` : **15 fichiers / 101 tests OK**
