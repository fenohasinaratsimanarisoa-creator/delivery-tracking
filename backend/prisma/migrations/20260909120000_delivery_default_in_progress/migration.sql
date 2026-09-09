-- Audit livraisons 2026-09-09 : toute livraison naît « en cours » (in_progress),
-- jamais « en attente » (pending). Le cycle de vie métier (assignation chauffeur,
-- preuve GPS, complétion) est piloté par les transitions de statut, pas par la
-- création. La valeur par défaut de la colonne est alignée sur ce comportement,
-- pour couvrir aussi les insertions directes (imports, scripts, seed).
ALTER TABLE "deliveries" ALTER COLUMN "status" SET DEFAULT 'in_progress';
