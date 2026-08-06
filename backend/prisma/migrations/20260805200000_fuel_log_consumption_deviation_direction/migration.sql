-- Champ de direction de l'écart de consommation (sur- vs sous-consommation).
--
-- Contexte : la détection d'anomalie de consommation est bidirectionnelle (écart ABSOLU),
-- mais le message de notification affirmait systématiquement un dépassement (« exceeded »),
-- y compris en sous-consommation (conso mesurée < théorique). Ce champ 'over'|'under' permet
-- au frontend d'afficher le sens réel de l'écart sans parser le texte du message.

-- CreateEnum
CREATE TYPE "ConsumptionDeviationDirection" AS ENUM ('over', 'under');

-- AlterTable : direction nullable, renseignée uniquement quand l'anomalie consommation est posée.
ALTER TABLE "fuel_logs"
  ADD COLUMN "consumption_deviation_direction" "ConsumptionDeviationDirection";
