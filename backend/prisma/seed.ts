import { PrismaClient, PlanTier } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function seedPlatformAdmin() {
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

// Paiement manuel 2026-09-15 : les 3 forfaits payants + l'essai (qui pointe sur
// 'enterprise', voir auth.service.ts::register()). Prix en Ariary (MGA),
// unités entières — la maquette Mobile Money (mobile-money.service.ts) exige
// des montants en unités entières, pas des centimes. Idempotent (upsert par
// tier, ré-exécutable sans effet de bord).
const BILLING_PLANS: Array<{
  tier: PlanTier;
  name: string;
  price: number;
  maxVehicles: number;
  maxDeliveriesPerMonth: number;
  maxUsers: number;
  features: string[];
}> = [
  {
    tier: 'starter',
    name: 'Simple',
    price: 35000,
    maxVehicles: 3,
    maxDeliveriesPerMonth: 200,
    maxUsers: 1,
    features: [
      'Suivi GPS temps réel',
      'Livraisons et preuves de livraison',
      'Rapport GPS carburant basique',
      'Alertes basiques (excès de vitesse, hors ligne)',
      'Support par email',
    ],
  },
  {
    tier: 'pro',
    name: 'Pro',
    price: 90000,
    maxVehicles: 10,
    maxDeliveriesPerMonth: 1000,
    maxUsers: 3,
    features: [
      'Tout Simple',
      'Synthèse carburant complète (jour/semaine/mois/an)',
      'Prix carburant et coûts estimés',
      'Alertes avancées (retard, écart de position, anomalie)',
      'Rapports et exports PDF/Excel',
      'Support email prioritaire',
    ],
  },
  {
    tier: 'enterprise',
    name: 'Business',
    price: 200000,
    maxVehicles: 30,
    maxDeliveriesPerMonth: 5000,
    // Illimité en pratique — pas de valeur "0"/null gérée ailleurs dans le
    // code pour "illimité", on utilise un plafond volontairement très haut.
    maxUsers: 999999,
    features: [
      'Tout Pro',
      'Export comptable',
      'Seuils d’alerte personnalisés',
      'Utilisateurs illimités',
      'Support prioritaire et accompagnement',
    ],
  },
];

async function seedBillingPlans() {
  for (const plan of BILLING_PLANS) {
    await prisma.billingPlan.upsert({
      where: { tier: plan.tier },
      update: {
        name: plan.name,
        price: plan.price,
        currency: 'MGA',
        interval: 'month',
        maxVehicles: plan.maxVehicles,
        maxDeliveriesPerMonth: plan.maxDeliveriesPerMonth,
        maxUsers: plan.maxUsers,
        features: plan.features,
        isActive: true,
      },
      create: {
        tier: plan.tier,
        name: plan.name,
        price: plan.price,
        currency: 'MGA',
        interval: 'month',
        maxVehicles: plan.maxVehicles,
        maxDeliveriesPerMonth: plan.maxDeliveriesPerMonth,
        maxUsers: plan.maxUsers,
        features: plan.features,
        isActive: true,
      },
    });
  }
  console.log(`[seed] Forfaits carburant/paiement manuel : ${BILLING_PLANS.length} plans à jour`);
}

// Numéro(s) Mobile Money affichés au client sur l'écran de paiement — liste
// gérable ensuite par un admin plateforme (platform-admin/payment-methods),
// pas codée en dur ailleurs. Pas de clé unique naturelle sur ce modèle :
// findFirst + create défensif, même idiome que seedPlatformAdmin ci-dessus.
async function seedPaymentMethods() {
  const phoneNumber = '038 59 166 11';
  const existing = await prisma.platformPaymentMethod.findFirst({ where: { phoneNumber } });
  if (existing) {
    console.log(`[seed] Moyen de paiement déjà présent : ${phoneNumber}`);
    return;
  }
  await prisma.platformPaymentMethod.create({
    data: {
      provider: 'orange_money',
      phoneNumber,
      holderName: 'FENOHASINA',
      isActive: true,
      sortOrder: 0,
    },
  });
  console.log(`[seed] Moyen de paiement créé : ${phoneNumber} (Orange Money, FENOHASINA)`);
}

async function main() {
  // Paiement manuel 2026-09-15 : plans/moyens de paiement d'abord — idempotents,
  // sans prérequis. seedPlatformAdmin() en dernier : il fait un process.exit(1)
  // dur si SEED_ADMIN_EMAIL est absent (comportement voulu pour un tout premier
  // bootstrap), ce qui ne doit PAS empêcher un simple `npm run prisma:seed` de
  // routine (sans cette variable en prod, l'admin existant n'a pas besoin d'être
  // retouché) de rafraîchir les plans/moyens de paiement.
  await seedBillingPlans();
  await seedPaymentMethods();
  await seedPlatformAdmin();
}

main()
  .catch((e) => {
    console.error('[seed] Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
