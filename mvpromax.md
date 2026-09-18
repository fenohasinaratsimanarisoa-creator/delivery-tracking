# MVP → Pro Max — feuille de route des fonctionnalités manquantes

> Issu de l'audit du 2026-09-18 (« qu'est-ce qui manque pour être un vrai projet
> avancé »). Chaque section ci-dessous est un **prompt prêt à copier-coller**
> pour lancer ce chantier plus tard, avec Claude Code ou tout autre agent — pas
> une spécification figée. À adapter/prioriser selon le contexte du moment
> (traction, contraintes techniques qui auront changé, etc.).

## Règle commune à TOUS les chantiers ci-dessous

Chaque prompt intègre cette contrainte, mais elle mérite d'être répétée une
fois clairement : **aucun de ces chantiers ne doit casser ce qui fonctionne
déjà en prod.** Avant de commencer et avant de déployer, systématiquement :

1. `cd backend && npx tsc --noEmit -p tsconfig.json && npx jest --silent`
2. `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run build && npx vitest run --silent`
3. Vérifier `git status` propre, ne committer que les fichiers du chantier en cours.
4. Déployer via `./scripts/deploy-contabo.sh` (jamais de commande docker manuelle) et
   confirmer `docker compose ps` (tous healthy) + `curl .../api/health` + logs sans
   erreur nouvelle avant de considérer le chantier terminé.
5. Ne jamais toucher au mapping position GPS ↔ véhicule (`traccar-bridge.service.ts`,
   matching par `String(pos.deviceId)` == `Vehicle.traccarDeviceId`) sans excellente
   raison — c'est le cœur du produit, tout casse si ça casse.
6. Pour toute nouvelle table/colonne : migration Prisma, jamais d'édition manuelle du
   schéma en prod.

---

## Priorité 1 — Produit (rétention à volume)

### 1.1 Optimisation de tournées multi-arrêts

```
Je veux ajouter l'optimisation de tournées multi-arrêts à DelivTrack : un
dispatcher assigne N livraisons à un chauffeur, l'app doit proposer l'ORDRE
de passage qui minimise distance/temps total (pas juste un trajet point à
point comme aujourd'hui avec OSRM).

Avant de coder : explore comment le routage actuel fonctionne
(services/routing/routingService.ts côté front, tout module backend qui
appelle OSRM) et comment les livraisons sont assignées à un chauffeur
aujourd'hui (deliveries.service.ts, DeliveriesPage.tsx). Propose un plan
avant d'implémenter : OSRM a un service "trip" (résolution TSP approchée) —
vérifie s'il est activé dans notre déploiement OSRM (osrm/Dockerfile,
osrm/prepare.sh) ou s'il faut l'activer/l'ajouter. Regarde aussi si un appel
groupé (batch de livraisons → ordre optimal) doit être un nouvel endpoint
backend ou un calcul frontend.

Contrainte : ne touche à AUCUNE logique de routage point-à-point existante
(RealTimeMap, DeliveryDetailPage, VehicleTripPage l'utilisent déjà et
fonctionnent) — cette fonctionnalité est additive, un nouveau mode
"tournée" à côté de l'existant, pas un remplacement.

Lance la suite de tests complète avant ET après (voir règle commune en tête
de mvpromax.md). Demande-moi confirmation du plan avant d'implémenter — ce
chantier touche potentiellement le schéma Prisma (nouvelle notion d'ordre
de tournée à persister).
```

### 1.2 Module de maintenance véhicule

```
Ajoute un module de maintenance préventive à DelivTrack : chaque véhicule a
un kilométrage courant (déjà dérivable des positions GPS ? à vérifier dans
tracking.service.ts) et des seuils d'entretien (vidange tous les X km,
contrôle technique à telle date). Le système doit alerter l'admin/dispatcher
quand un seuil approche, sur le même canal que les alertes existantes
(vitesse/arrêt/géofence — regarde alerts.module et comment ces alertes sont
générées et affichées côté AlertsPage.tsx AVANT de coder, pour rester
cohérent avec le pattern existant plutôt que d'inventer un système parallèle).

Nouveau : table Prisma `vehicle_maintenance_schedule` (ou équivalent) —
migration propre, jamais de colonne ajoutée à la main. Endpoint CRUD
backend + section dans FleetPage.tsx (édition véhicule) pour configurer les
seuils, + widget dashboard.

Contrainte : n'ajoute pas de nouvelle dépendance externe (bibliothèque de
calcul de distance parcourue) sans vérifier d'abord ce qui existe déjà dans
tracking.service.ts pour calculer un kilométrage cumulé par véhicule.

Suite de tests complète avant/après (règle commune). Demande confirmation
du plan avant d'implémenter.
```

### 1.3 Scoring conducteur / analytics comportementale

```
Ajoute un score de conduite par chauffeur, basé sur les données GPS déjà
collectées (accélérations/freinages brusques dérivables de la vitesse entre
deux positions consécutives, excès de vitesse déjà détecté par les alertes
existantes — regarde comment `generateAlerts` dans tracking.service.ts
calcule déjà la vitesse avant de dupliquer cette logique).

Objectif : un score composite (0-100) par chauffeur, visible sur
DriversPage.tsx et dans un nouveau rapport (ReportsPage.tsx a déjà un
pattern de rapport périodique — fuel-period-summary en est un exemple
récent, imite ce pattern plutôt que d'en inventer un nouveau).

Contrainte : calcul en tâche de fond (cron ou job différé, PAS en tâche
bloquante du hot path d'ingestion GPS dans traccar-bridge.service.ts —
ce chemin est déjà optimisé et sensible à la latence, ne pas y ajouter de
calcul lourd synchrone).

Suite de tests complète avant/après (règle commune). Demande confirmation
du plan avant d'implémenter, en particulier sur la formule du score (à
valider avec moi, pas une décision technique pure).
```

### 1.4 Notifications client WhatsApp/SMS

```
Ajoute un canal de notification WhatsApp Business API (ou SMS, à trancher
ensemble avant de coder) pour le suivi de livraison côté client — en plus
du lien web existant (PublicTrackingPage.tsx, déjà fonctionnel, n'y touche
pas). Le déclenchement doit réutiliser les événements de changement de
statut de livraison déjà émis (regarde deliveries.service.ts et le système
d'email existant, EmailService, comme modèle direct : même pattern
d'envoi asynchrone non-bloquant avec .catch() sur échec, ne jamais faire
échouer une mutation métier à cause d'un envoi de notification raté).

Avant de coder : je dois choisir et configurer un fournisseur (WhatsApp
Business API via Meta, ou un agrégateur SMS malgache) — ne code RIEN tant
que je n'ai pas donné de clé API réelle. Prépare d'abord juste le plan +
l'interface (quel provider, quel format de message, à quel moment il part)
pour validation.

Suite de tests complète avant/après (règle commune).
```

### 1.5 Marque blanche (white-label)

```
Prépare DelivTrack à la marque blanche : aujourd'hui le nom "Pistio" est en
dur dans plusieurs endroits (emails — EMAIL_FROM et les templates dans
common/i18n/translations.ts, index.html, l'UI). Objectif : rendre ça
configurable PAR ENTREPRISE (table Company a-t-elle déjà des champs de
branding ? vérifie schema.prisma avant de coder) — logo, nom affiché,
couleur d'accent, domaine d'envoi email.

C'est un chantier large et risqué (touche l'auth, les emails, le thème
CSS) — ne fonce pas dans l'implémentation. Fais d'abord un audit complet
(comme celui du 2026-09-18 sur les pages orphelines) de TOUS les endroits
où "Pistio"/"DelivTrack" est en dur, présente la liste, et attends ma
priorisation avant de toucher au code. Certains de ces endroits touchent
la délivrabilité email (domaine vérifié Resend) — ne jamais changer
EMAIL_FROM sans confirmation explicite (cf. mémoire "email-domain",
un changement mal fait casse TOUS les emails sortants).
```

---

## Priorité 2 — Infrastructure (ce qui bloque à l'échelle)

### 2.1 Suivi d'erreurs en production (Sentry)

```
Configure Sentry (ou équivalent) pour le backend ET le frontend en
production. `SENTRY_DSN` n'est actuellement pas configuré (voir le log de
démarrage "[STARTUP] SENTRY_DSN not set — errors will NOT be reported to
Sentry" dans backend/src/main.ts) — le code semble déjà prévoir
l'intégration, vérifie d'abord ce qui existe (grep "Sentry" dans tout le
repo) avant d'ajouter quoi que ce soit.

Ce chantier est probablement à 80% de la config (créer un compte/projet
Sentry, ajouter la clé au .env prod) et 20% de code. Ne casse pas le
comportement actuel en l'absence de clé (le fallback "log seulement" doit
rester le comportement si SENTRY_DSN est vide, ne force jamais un crash au
démarrage si Sentry n'est pas configurable).

Coût quasi nul, haute valeur — bon candidat pour être fait en premier,
avant les chantiers plus lourds ci-dessus.
```

### 2.2 Haute disponibilité / redondance

```
Audit (PAS d'implémentation immédiate) de ce qu'il faudrait pour une
vraie HA : réplique Postgres (lecture/écoute), plusieurs instances backend
derrière un load balancer, health-check automatique avec bascule. Regarde
docker-compose.contabo.yml, DEPLOYMENT.md et le budget/l'infra actuelle
(VPS Contabo unique) pour évaluer le coût réel (argent + complexité
opérationnelle) de chaque option avant de proposer un plan. Un seul VPS
avec un bon monitoring (voir 2.1) et des sauvegardes vérifiées (voir 2.3)
suffit probablement encore au volume actuel — ne sur-ingénierie pas cette
partie avant qu'elle soit un vrai goulot d'étranglement mesuré.
```

### 2.3 Vérifier que les sauvegardes marchent VRAIMENT

```
`scripts/backup.sh` / le service `backup` de docker-compose.contabo.yml
existent déjà (conteneur `delivery-tracking-backup`, tourne depuis 3
semaines). Avant tout autre chantier d'infra : vérifie qu'une restauration
RÉELLE fonctionne (pas juste que le backup s'exécute sans erreur) — sur un
environnement de test, jamais sur la prod. Documente la procédure de
restauration si elle n'existe pas déjà. C'est le genre de chose qu'on
découvre cassée le jour où on en a besoin — à vérifier une fois pour
toutes, coût faible, tranquillité d'esprit énorme.
```

### 2.4 Stratégie de rétention des données GPS

```
Audit (PAS d'implémentation immédiate) : la table gps_positions grossit
d'une ligne toutes les quelques secondes par véhicule actif. Mesure sa
taille actuelle (nombre de lignes, taille sur disque — requête SQL simple
sur la prod, lecture seule) et projette la croissance à 50/100/500
véhicules. Propose une stratégie d'archivage (partitionnement par mois,
agrégation des vieilles données en résumés horaires/journaliers au-delà
d'une certaine ancienneté — gps_archive existe-t-il déjà comme table
séparée ? vérifie schema.prisma) SANS rien implémenter avant validation du
plan avec moi — une mauvaise politique de rétention peut casser les
rapports historiques (TripReportPage, replay de trajet) si mal pensée.
```

---

## Priorité 3 — Modèle économique

### 3.1 Automatiser le paiement Mvola (déjà codé, éteint)

```
Active le paiement automatisé Mvola Merchant Pay, déjà intégré dans le code
(backend/src/modules/billing/mobile-money.service.ts — API réelle, pas un
stub) mais éteint (BILLING_ENABLED=false, pas de compte marchand
configuré). Étape 1 (moi, pas toi) : obtenir un compte marchand Telma/MVola
et les clés API réelles. Étape 2 (toi, une fois les clés en main) : tester
en sandbox (MOBILE_MONEY_SANDBOX=true) AVANT tout passage en prod, vérifier
que le flux complet marche (checkout → webhook → activation) sans jamais
désactiver le flux manuel existant en parallèle tant que l'automatisé n'a
pas fait ses preuves sur plusieurs paiements réels.

Voir la mémoire "flotte-imei-provisioning" / l'audit du mode de paiement du
2026-09-18 pour le contexte complet (pourquoi c'est resté manuel jusqu'ici,
et pourquoi automatiser la config SMS des traceurs GPS est un chantier
différent et non retenu, à ne pas confondre avec celui-ci).
```

### 3.2 Accès API pour intégrateurs (marge additionnelle)

```
backend/INTEGRATION.md documente déjà une API B2B mais elle n'est
probablement pas commercialisée (pas de gestion de clés API par client, pas
de rate limiting différencié par plan). Audit d'abord : qu'est-ce qui
existe déjà (lis backend/INTEGRATION.md en entier, c'est un fichier
gitignoré donc pas dans l'historique git — lis-le directement sur le
disque), qu'est-ce qu'il manque pour vendre un accès API à la carte
(génération de clé API par entreprise, quota par plan tarifaire, page de
doc publique). Propose un plan avant de coder.
```

---

## Ce qui est déjà un atout — ne pas diluer en chassant la parité fonctionnelle

La localisation Madagascar (Mvola/Orange Money natifs, francophone, support
traceurs GSM bas coût GT06/Teltonika) est un avantage compétitif réel face
aux acteurs globaux (Samsara, Fleet Complete) qui ne descendent jamais à ce
niveau de finesse locale. Aucun chantier ci-dessus ne doit affaiblir cet
ancrage local au profit d'une parité fonctionnelle générique — en cas de
doute sur une priorité, celle qui renforce la profondeur locale gagne sur
celle qui imite un concurrent global.
