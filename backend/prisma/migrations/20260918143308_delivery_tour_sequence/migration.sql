-- Ordre de passage dans une tournée optimisée (mvpromax.md §1.1 — optimisation
-- multi-arrêts). Colonne NULLABLE, sans défaut : une livraison qui n'a jamais
-- fait partie d'une tournée optimisée garde tour_sequence = NULL, aucun impact
-- sur le comportement existant (aucune requête existante ne lit/écrit cette
-- colonne). Renseignée uniquement par DeliveriesService.optimizeTour().

ALTER TABLE "deliveries"
  ADD COLUMN "tour_sequence" INTEGER;
