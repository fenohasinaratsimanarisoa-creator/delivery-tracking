# PRÉCISION GPS — attentes réelles par matériel

Ce document fixe les attentes de précision QUE L'ON PEUT TENIR avec le matériel
utilisé (smartphones Android + traceurs GPS grand public GT06/TK103/Concox), pour
ne pas promettre aux clients une précision que le matériel ne peut pas donner.

> **Principe :** nous visons la MEILLEURE précision atteignable avec CE matériel.
> Il n'y a **pas** de RTK (positionnement centimétrique) : la précision civile
> standard est de **3 à 15 mètres** selon l'environnement, quel que soit le
> logiciel utilisé.

---

## 1. Précision attendue par type de matériel

| Matériel | Précision typique | Conditions dégradées | Notes |
|---|---|---|---|
| **Smartphone milieu/haut de gamme** (2019+, GPS + GLONASS + Galileo) | **3–8 m** | 10–30 m en canyon urbain / sous arbres denses | Le meilleur choix pour le tracking chauffeur. |
| **Smartphone entrée de gamme** (Xiaomi/Redmi bas de gamme, téléphones "clone") | **5–15 m** | 20–50 m | Antenne GPS plus petite, firmware moins bon. |
| **Traceur GT06 / TK103 / Concox** (SIMA/2G/4G) | **5–15 m** (statique), **10–30 m** (en mouvement) | 50–200 m en ville dense, pertes en tunnel/parking souterrain | Dépend beaucoup de la qualité d'installation (antenne dégagée vers le ciel) et du réseau SIM. |
| **Traceur haut de gamme** (Concox avec support Galileo/BDS) | **3–10 m** | 15–40 m | Rare dans le parc actuel. |

### Ce que ça veut dire concrètement

- **À l'arrêt** : les positions "dérivent" de 5 à 15 m autour de la position réelle
  (le GPS ne se stabilise pas à 0 m). C'est un comportement normal, pas un bug :
  le filtre (Kalman) et la détection de bruit GPS du backend atténuent cette dérive
  pour l'affichage et le calcul de distance, **sans inventer de position**.
- **En ville dense** (Antananarivo centre, immeubles) : attendez 15–30 m d'écart
  entre la position affichée et le lieu réel. Les réflexions de signaux sur les
  immeubles sont physiques.
- **En intérieur / tunnel / parking souterrain** : plus aucune position GPS n'est
  possible. Le trajet affiche un trou (signal GPS interrompu) — c'est DÉTECTÉ et
  signalé dans le rapport, jamais masqué par une ligne droite silencieuse.

## 2. Ce que fait le système pour atteindre le maximum possible

| Mécanisme | Où | Effet |
|---|---|---|
| `PRIORITY_HIGH_ACCURACY` (Fused Location Provider) | `LocationForegroundService.java` + `watchPosition(enableHighAccuracy:true)` | Demande le meilleur fix possible ; aucune dégradation en arrière-plan. |
| Filtre de Kalman (affichage uniquement) | `KalmanFilter.ts` | Lisse le bruit de mesure GPS pour l'affichage. **Ne filtre jamais les données envoyées au backend** : les coordonnées brutes partent telles quelles. |
| Fusion de capteurs (accéléromètre + gyroscope + accélération linéaire) | `sensorFusion.ts` | Détecte arrêt/mouvement pour adapter la cadence d'envoi. N'invente **aucune** position : les capteurs servent à la classification du mouvement, pas à l'extrapolation. |
| Dead reckoning (affichage uniquement) | `deadReckoning.ts` (`predictPosition`) | Extrapole visuellement entre deux fixes pendant quelques secondes. **Strictement côté client, jamais envoyé au backend ni enregistré** (testé : `deadReckoning.spec.ts`). |
| Détection de téléportation / bruit | backend `teleportation.utils` | Les sauts aberrants sont marqués `suspect` et exclus des calculs de distance fiables. |
| Gap detection | `getTripReport()` | Tout écart > 3 min sans position est signalé dans le rapport ("signal GPS interrompu entre 14h32 et 14h41"). |
| Couverture GPS | `getTripReport()` / `GET /tracking/reliability` | % réel du temps de livraison avec position valide, par trajet et par véhicule — pour mesurer la fiabilité obtenue plutôt que la promettre. |

## 3. Limites physiques (aucune app ne peut les dépasser)

- **Précision civile sans RTK** : 3–15 m (50 % de probabilité), 8–25 m (95 %).
  C'est la limite du signal GPS civil mondial.
- **Aucun signal GPS à l'intérieur** (bâtiments, tunnels, parkings souterrains).
- **Téléphone réellement éteint / déchargé** : aucune app ne peut tourner.
- **Force-stop volontaire depuis les Paramètres Android** : Android tue le process
  sans aucun callback possible. La détection se fait alors par le **moniteur de
  silence serveur** (alerte dashboard sous 5–10 min) et par le **marqueur
  d'interruption** signalé au prochain lancement de l'app.
- **Zone sans couverture réseau** : la position continue d'être capturée et
  stockée localement (file IndexedDB persistante, jusqu'à 5000 positions) ; elle
  est synchronisée intégralement au retour du réseau.

## 4. Pour fixer des attentes justes avec vos clients

À communiquer tel quel :

> "Le suivi GPS affiche la position du véhicule avec une précision de 3 à 15
> mètres en zone dégagée, jusqu'à 30 m en ville dense. Dans les tunnels, parkings
> souterrains et bâtiments, le signal GPS est interrompu : le système le détecte
> et le signale explicitement dans le rapport de trajet. La fiabilité du suivi
> (temps réellement couvert) est mesurable par véhicule dans le rapport de
> fiabilité — nous nous engageons sur la détection et la transparence, pas sur
> une précision physique que le matériel ne peut pas tenir."
