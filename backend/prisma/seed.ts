import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  if (!email) {
    console.error('[seed] SEED_ADMIN_EMAIL is required — set it in .env or environment');
    process.exit(1);
  }

  const rawPassword = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(24).toString('base64url');
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  ⚠️  SEED_ADMIN_PASSWORD non défini                        ║');
    console.log(`║  Mot de passe généré (affiché une seule fois) :             ║`);
    console.log(`║  ${rawPassword}  ║`);
    console.log('║  Sauvegardez-le immédiatement.                              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
  }

  const hashedPassword = await bcrypt.hash(rawPassword, 12);
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await prisma.platformAdmin.findUnique({ where: { email: normalizedEmail } });

  if (existing) {
    const isSamePassword = await bcrypt.compare(rawPassword, existing.passwordHash);
    if (!isSamePassword) {
      await prisma.platformAdmin.update({
        where: { email: normalizedEmail },
        data: { passwordHash: hashedPassword },
      });
      console.log(`[seed] Password updated for: ${normalizedEmail}`);
    } else {
      console.log(`[seed] Super admin already exists: ${normalizedEmail}`);
    }
    return;
  }

  await prisma.platformAdmin.create({
    data: {
      email: normalizedEmail,
      passwordHash: hashedPassword,
      firstName: process.env.SEED_ADMIN_FIRST_NAME || 'Admin',
      lastName: process.env.SEED_ADMIN_LAST_NAME || 'User',
      isActive: true,
    },
  });

  console.log(`[seed] Super admin created: ${normalizedEmail}`);
}

main()
  .catch((e) => {
    console.error('[seed] Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
