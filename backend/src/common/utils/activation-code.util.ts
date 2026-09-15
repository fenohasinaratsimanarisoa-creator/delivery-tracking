import * as crypto from 'crypto';

// Paiement manuel 2026-09-15 : code d'activation COURT et prononçable au
// téléphone/SMS (contrairement au jeton brut 64-hex des invitations,
// invitations.service.ts) — l'admin le communique à l'oral ou par SMS après
// avoir vérifié une preuve de paiement. Alphabet sans caractères ambigus
// (pas de I/L/O/0/1) ; 32 lettres = puissance de 2 divisant 256 exactement,
// donc aucun biais de modulo sur les octets aléatoires.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_SUFFIX_LENGTH = 8;

export interface GeneratedActivationCode {
  /** Code complet, à ne JAMAIS repersister en clair — montré une seule fois à l'admin. */
  code: string;
  /** Moitié affichable en clair dans la liste admin, insuffisante pour deviner le code. */
  prefix: string;
  /** sha256(code normalisé) — seule valeur stockée en base. */
  hash: string;
}

export function generateActivationCode(): GeneratedActivationCode {
  const bytes = crypto.randomBytes(CODE_SUFFIX_LENGTH);
  let suffix = '';
  for (let i = 0; i < CODE_SUFFIX_LENGTH; i++) {
    suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  const code = `PAY-${suffix}`;
  return { code, prefix: `PAY-${suffix.slice(0, 4)}`, hash: hashActivationCode(code) };
}

/** Normalise (espaces/casse) avant hash pour tolérer la saisie manuelle du client. */
export function hashActivationCode(rawCode: string): string {
  return crypto.createHash('sha256').update(rawCode.trim().toUpperCase()).digest('hex');
}
