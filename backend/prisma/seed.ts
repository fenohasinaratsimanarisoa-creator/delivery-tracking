import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const email = 'fenohasinaratsimanarisoa@gmail.com'.toLowerCase().trim();
  const rawPassword = 'mandriMena45!';
  const hashedPassword = await bcrypt.hash(rawPassword, 12);

  const existing = await prisma.platformAdmin.findUnique({ where: { email } });

  if (existing) {
    const isSamePassword = await bcrypt.compare(rawPassword, existing.passwordHash);
    if (!isSamePassword) {
      await prisma.platformAdmin.update({
        where: { email },
        data: { passwordHash: hashedPassword },
      });
      console.log(`[seed] Password updated for: ${email}`);
    } else {
      console.log(`[seed] Super admin already exists: ${email}`);
    }
    return;
  }

  await prisma.platformAdmin.create({
    data: {
      email,
      passwordHash: hashedPassword,
      firstName: 'Fenohasina',
      lastName: 'Ratsimanarisoa',
      isActive: true,
    },
  });

  console.log(`[seed] Super admin created: ${email}`);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  ⚠️  MOT DE PASSE PARTAGÉ EN CLAIR DANS UN PROMPT          ║');
  console.log('║  Tu DOIS le changer immédiatement depuis l\'interface :     ║');
  console.log('║  /admin → onglet Admins → bouton "Changer mot de passe"    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

main()
  .catch((e) => {
    console.error('[seed] Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
