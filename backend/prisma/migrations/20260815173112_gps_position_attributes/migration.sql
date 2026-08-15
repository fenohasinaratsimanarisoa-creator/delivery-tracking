-- GpsPosition.attributes : télémétrie matériel des traceurs physiques.
--
-- Contexte : les traceurs GPS (GT06, Teltonika, TK103…) remontent via l'objet
-- Position normalisé de Traccar un sous-ensemble de Position.attributes incluant
-- selon le modèle : `power` (tension d'alimentation véhicule), `battery` (niveau
-- batterie interne du traceur) et parfois `ignition` (état du contact). Ces
-- champs sont stockés ici pour :
--   1. alerter en temps réel (coupure électrique véhicule / batterie traceur critique) ;
--   2. classer la CAUSE probable d'un silence GPS prolongé côté dashboard
--      (coupure véhicule vs batterie traceur vs panne SIM/matériel) au lieu de
--      laisser le développeur deviner.
-- NULL pour les positions issues de l'app téléphone (aucune télémétrie matériel).
--
-- Colonne JSONB (pas de migration de données : colonne nullable, aucun impact
-- sur les positions existantes).

ALTER TABLE "gps_positions"
  ADD COLUMN "attributes" JSONB;
