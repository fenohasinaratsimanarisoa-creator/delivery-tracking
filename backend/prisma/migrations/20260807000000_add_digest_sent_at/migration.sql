-- La colonne digest_sent_at manquait dans l'historique des migrations alors que
-- le schéma (Notification.digestSentAt) la déclare. Sans elle, tout INSERT/SELECT
-- sur "notifications" échoue (colonne inexistante) → les notifications et les
-- alertes sont cassées sur les bases créées depuis les migrations.
-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "digest_sent_at" TIMESTAMP(3);
