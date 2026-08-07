-- La colonne digest_sent_at manquait dans l'historique des migrations alors que
-- le schéma (Notification.digestSentAt) la déclare. Sans elle, tout INSERT/SELECT
-- sur "notifications" échoue (colonne inexistante) → les notifications et les
-- alertes sont cassées sur les bases créées depuis les migrations.
-- IF NOT EXISTS : les bases synchronisées par `prisma db push` ont déjà la
-- colonne (dérive historique) — la migration doit rester inoffensive pour elles.
-- AlterTable
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "digest_sent_at" TIMESTAMP(3);
