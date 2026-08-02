-- Audit log : nouvelle action dédiée à l'impersonation d'un admin de plateforme.
-- Ajout de valeur enum, non-breaking (les valeurs existantes sont conservées).
ALTER TYPE "AuditAction" ADD VALUE 'admin_impersonation';
