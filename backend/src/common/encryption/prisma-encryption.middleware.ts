import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from './encryption.service';

interface EncryptedField {
  model: string;
  field: string;
}

const SENSITIVE_FIELDS: EncryptedField[] = [
  { model: 'User', field: 'phone' },
  { model: 'User', field: 'totpSecret' },
  { model: 'Company', field: 'phone' },
  { model: 'Company', field: 'address' },
  { model: 'Driver', field: 'phone' },
  { model: 'Delivery', field: 'pickupAddress' },
  { model: 'Delivery', field: 'deliveryAddress' },
  { model: 'PlatformAdmin', field: 'totpSecret' },
  // Webhook.secret n'est JAMAIS cherché via un `where` (toujours lu après un
  // findFirst/findUnique par id) — chiffrement réversible sûr ici, contrairement
  // à Invitation.token qui est haché (voir invitations.service.ts) car il DOIT
  // rester matchable par `where: { token }` sur la valeur brute reçue du client.
  { model: 'Webhook', field: 'secret' },
];

@Injectable()
export class PrismaEncryptionMiddleware implements OnApplicationBootstrap {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  onApplicationBootstrap() {
    if (!this.encryption.isEnabled()) return;

    this.prisma.$use(async (params, next) => {
      if (this.isWriteAction(params.action)) {
        const fields = SENSITIVE_FIELDS.filter((f) => f.model === params.model);
        if (fields.length > 0) {
          // upsert a une forme {where, create, update} plutôt que {data} : on
          // chiffre les deux sous-objets s'ils existent, sinon le data plat.
          const targets: Record<string, unknown>[] = params.args?.create
            ? [params.args.create, params.args.update].filter(Boolean)
            : params.args?.data
              ? [params.args.data]
              : [];

          for (const target of targets) {
            for (const f of fields) {
              if (target[f.field]) {
                const encrypted = this.encryption.encrypt(target[f.field] as string);
                if (encrypted) {
                  target[f.field] = encrypted;
                }
              }
            }
          }
        }
      }

      const result = await next(params);

      if (result && this.isReadAction(params.action)) {
        const readFields = SENSITIVE_FIELDS.filter((f) => f.model === params.model);
        if (readFields.length > 0) {
          this.decryptResult(result, readFields);
        }
      }

      return result;
    });
  }

  private isWriteAction(action: string): boolean {
    return ['create', 'update', 'updateMany', 'upsert'].includes(action);
  }

  private isReadAction(action: string): boolean {
    return [
      'findUnique',
      'findFirst',
      'findMany',
      'findFirstOrThrow',
      'findUniqueOrThrow',
    ].includes(action);
  }

  private decryptResult(result: unknown, fields: EncryptedField[]): void {
    if (!result) return;

    const decryptField = (obj: Record<string, unknown>) => {
      for (const f of fields) {
        const val = obj[f.field];
        if (typeof val === 'string' && val.includes(':')) {
          const decrypted = this.encryption.decrypt(val);
          if (decrypted !== null) {
            obj[f.field] = decrypted;
          }
        }
      }
    };

    if (Array.isArray(result)) {
      for (const item of result) {
        if (typeof item === 'object' && item !== null) {
          decryptField(item as Record<string, unknown>);
        }
      }
    } else if (typeof result === 'object' && result !== null) {
      decryptField(result as Record<string, unknown>);
    }
  }
}
