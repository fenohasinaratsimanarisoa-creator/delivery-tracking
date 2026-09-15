import { memoryStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/**
 * Options Multer pour l'upload d'une image (preuve de paiement, système de
 * paiement manuel 2026-09-15). Mémoire uniquement — jamais écrit sur disque :
 * le fichier va directement dans une colonne `Bytes` (même idiome que
 * `Invoice.pdfData`), aucun stockage S3/disque à opérer/sauvegarder pour un
 * volume de soumissions faible. Passé directement en option de
 * `FileInterceptor(...)`, pas besoin d'enregistrer `MulterModule` globalement.
 */
export const imageUploadMulterOptions: MulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
};

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
