-- AddColumn
ALTER TABLE "user_sessions" ADD COLUMN "refresh_token_hash" TEXT;

-- Invalidation des ANCIENS refreshTokenHash stockés sur User (champ conservé
-- pour compatibilité descendante mais plus utilisé par la logique) : les tokens
-- pré-migration ne correspondent plus à aucune session UserSession durablement
-- identifiée → échec propre du refresh (401) et reconnexion au déploiement.
UPDATE "users" SET "refresh_token_hash" = NULL;