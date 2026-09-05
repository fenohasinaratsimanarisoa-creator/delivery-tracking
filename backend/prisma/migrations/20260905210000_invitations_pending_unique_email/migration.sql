-- Audit sécurité 2026-09-05 : le pré-check applicatif (findFirst avant create)
-- dans invitations.service.ts n'était protégé par aucune contrainte DB, donc
-- deux requêtes concurrentes pouvaient créer 2 invitations "pending" actives
-- pour le même email dans la même entreprise. Index unique PARTIEL (seulement
-- sur status='pending' : une invitation acceptée/révoquée/expirée ne doit pas
-- bloquer un nouvel envoi).
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_pending_email_company_unique"
  ON "invitations"("company_id", "email")
  WHERE "status" = 'pending';
