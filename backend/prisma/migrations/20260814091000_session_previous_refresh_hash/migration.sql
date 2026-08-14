-- UserSession.previousRefreshTokenHash : historique de rotation (un niveau).
--
-- Le cookie de refresh est partagé entre les onglets du navigateur : deux
-- refreshes concurrents (au démarrage, onglets multiples) tournaient sur le
-- même hash bcrypt ; le "perdant" (token du premier gagnant écrasé) produisait
-- un mismatch, interprété comme un REUSE → session révoquée → déconnexion en
-- cascade de tous les onglets. La rotation dans generateTokens devient
-- atomique (previous = refresh_token_hash courant) et la vérification dans
-- refresh() accepte ET re-rotate le token qui correspond à previous (course
-- légitime) au lieu de révoquer.

ALTER TABLE "user_sessions"
  ADD COLUMN "previous_refresh_token_hash" TEXT;