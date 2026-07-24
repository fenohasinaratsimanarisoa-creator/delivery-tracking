export type Language = 'fr' | 'en';

const translations: Record<string, Record<Language, string>> = {
  'email.passwordReset.heading': {
    fr: 'Réinitialisation de votre mot de passe',
    en: 'Reset your password',
  },
  'email.passwordReset.body': {
    fr: 'Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le lien ci-dessous pour définir un nouveau mot de passe. Ce lien expire dans 30 minutes.',
    en: 'You requested a password reset. Click the link below to set a new password. This link expires in 30 minutes.',
  },
  'email.passwordReset.button': {
    fr: 'Réinitialiser mon mot de passe',
    en: 'Reset my password',
  },
  'email.passwordReset.footer': {
    fr: "Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.",
    en: 'If you did not request this reset, please ignore this email.',
  },
  'email.passwordReset.subject': {
    fr: 'Réinitialisation de mot de passe — DeliveryTrack',
    en: 'Password Reset — DeliveryTrack',
  },
  'email.invitation.heading': {
    fr: 'Invitation à rejoindre DeliveryTrack',
    en: 'Invitation to join DeliveryTrack',
  },
  'email.invitation.body': {
    fr: 'Vous avez été invité(e) à rejoindre DeliveryTrack en tant que <strong>{role}</strong>. Cliquez sur le lien ci-dessous pour créer votre compte.',
    en: 'You have been invited to join DeliveryTrack as <strong>{role}</strong>. Click the link below to create your account.',
  },
  'email.invitation.button': {
    fr: "Accepter l'invitation",
    en: 'Accept invitation',
  },
  'email.invitation.footer': {
    fr: 'Ce lien expire dans 7 jours.',
    en: 'This link expires in 7 days.',
  },
  'email.invitation.subject': {
    fr: 'Invitation — DeliveryTrack',
    en: 'Invitation — DeliveryTrack',
  },
  'email.digest.brand': {
    fr: 'LogiTrack',
    en: 'LogiTrack',
  },
  'email.digest.subtitle': {
    fr: 'Rapport hebdomadaire • {weekRange}',
    en: 'Weekly report • {weekRange}',
  },
  'email.digest.greeting': {
    fr: 'Bonjour {firstName},',
    en: 'Hello {firstName},',
  },
  'email.digest.intro': {
    fr: 'Voici le résumé de votre activité sur <strong>{companyName}</strong> cette semaine.',
    en: 'Here is your activity summary for <strong>{companyName}</strong> this week.',
  },
  'email.digest.metricDeliveries': {
    fr: 'Livraisons',
    en: 'Deliveries',
  },
  'email.digest.metricPunctuality': {
    fr: 'Ponctualité',
    en: 'Punctuality',
  },
  'email.digest.metricAlerts': {
    fr: 'Alertes',
    en: 'Alerts',
  },
  'email.digest.anomalySection': {
    fr: 'Alertes carburant en attente',
    en: 'Pending fuel alerts',
  },
  'email.digest.anomalyVehicle': {
    fr: 'Véhicule',
    en: 'Vehicle',
  },
  'email.digest.anomalyVolume': {
    fr: 'Volume',
    en: 'Volume',
  },
  'email.digest.anomalyDate': {
    fr: 'Date',
    en: 'Date',
  },
  'email.digest.ctaButton': {
    fr: 'Ouvrir le tableau de bord',
    en: 'Open dashboard',
  },
  'email.digest.footer': {
    fr: 'Ce message est automatique — merci de ne pas y répondre.',
    en: 'This is an automated message — please do not reply.',
  },
  'email.digest.subject': {
    fr: 'Rapport hebdomadaire — LogiTrack ({weekRange})',
    en: 'Weekly report — LogiTrack ({weekRange})',
  },
  'email.welcome.heading': {
    fr: 'Bienvenue sur DeliveryTrack',
    en: 'Welcome to DeliveryTrack',
  },
  'email.welcome.body': {
    fr: 'Bonjour {firstName},<br/>Votre compte a été créé avec succès. Vous pouvez dès à présent vous connecter et gérer vos livraisons.',
    en: 'Hello {firstName},<br/>Your account has been created successfully. You can now log in and manage your deliveries.',
  },
  'email.welcome.button': {
    fr: 'Se connecter',
    en: 'Sign in',
  },
  'email.welcome.subject': {
    fr: 'Bienvenue sur DeliveryTrack',
    en: 'Welcome to DeliveryTrack',
  },
  'email.billing.activatedSubject': {
    fr: 'Abonnement activé — DeliveryTrack',
    en: 'Subscription activated — DeliveryTrack',
  },
  'email.billing.activatedBody': {
    fr: '<p>Bonjour {firstName},</p><p>Votre abonnement <strong>{planName}</strong> est maintenant actif.</p><p>Vous pouvez dès à présent utiliser toutes les fonctionnalités de votre forfait.</p><p><a href="{url}">Accéder à la facturation</a></p>',
    en: '<p>Hello {firstName},</p><p>Your <strong>{planName}</strong> subscription is now active.</p><p>You can now use all features of your plan.</p><p><a href="{url}">View billing</a></p>',
  },
  'email.billing.paymentFailedSubject': {
    fr: 'Paiement échoué — DeliveryTrack',
    en: 'Payment failed — DeliveryTrack',
  },
  'email.billing.paymentFailedBody': {
    fr: '<p>Bonjour {firstName},</p><p>Le paiement de votre abonnement a échoué. Votre compte est désormais en statut "past_due".</p><p>Merci de mettre à jour vos informations de paiement pour éviter une suspension.</p><p><a href="{url}">Accéder à la facturation</a></p>',
    en: '<p>Hello {firstName},</p><p>Your subscription payment failed. Your account is now past due.</p><p>Please update your payment information to avoid suspension.</p><p><a href="{url}">View billing</a></p>',
  },
  'email.billing.canceledSubject': {
    fr: 'Abonnement résilié — DeliveryTrack',
    en: 'Subscription canceled — DeliveryTrack',
  },
  'email.billing.canceledBody': {
    fr: '<p>Bonjour {firstName},</p><p>Votre abonnement a été résilié. Vous pouvez souscrire à un nouveau forfait à tout moment.</p><p><a href="{url}">Voir les forfaits</a></p>',
    en: '<p>Hello {firstName},</p><p>Your subscription has been canceled. You can subscribe to a new plan at any time.</p><p><a href="{url}">View plans</a></p>',
  },
  'email.billing.expiredSubject': {
    fr: 'Votre abonnement DeliveryTrack est arrivé à expiration',
    en: 'Your DeliveryTrack subscription has expired',
  },
  'email.billing.expiredBody': {
    fr: '<p>Bonjour {firstName},</p><p>Votre abonnement a expiré le {date}.</p><p>Pour continuer à utiliser DeliveryTrack, merci de renouveler votre abonnement.</p><p><a href="{url}">Accéder à la facturation</a></p>',
    en: '<p>Hello {firstName},</p><p>Your subscription expired on {date}.</p><p>To continue using DeliveryTrack, please renew your subscription.</p><p><a href="{url}">View billing</a></p>',
  },
  'email.billing.suspendedSubject': {
    fr: 'Abonnement suspendu — DeliveryTrack',
    en: 'Subscription suspended — DeliveryTrack',
  },
  'email.billing.suspendedBody': {
    fr: '<p>Bonjour {firstName},</p><p>Votre abonnement a été suspendu pour impayé.</p><p>Certaines fonctionnalités sont désactivées. Régularisez votre situation depuis votre espace facturation.</p><p><a href="{url}">Accéder à la facturation</a></p>',
    en: '<p>Hello {firstName},</p><p>Your subscription has been suspended for non-payment.</p><p>Some features are disabled. Please regularize your situation from your billing area.</p><p><a href="{url}">View billing</a></p>',
  },
  'pdf.invoice.title': {
    fr: 'FACTURE',
    en: 'INVOICE',
  },
  'pdf.invoice.invoiceNumber': {
    fr: 'Facture n° {number}',
    en: 'Invoice n° {number}',
  },
  'pdf.invoice.issueDate': {
    fr: "Date d'émission : {date}",
    en: 'Issue date: {date}',
  },
  'pdf.invoice.period': {
    fr: 'Période : {start} — {end}',
    en: 'Period: {start} — {end}',
  },
  'pdf.invoice.subscription': {
    fr: 'Abonnement : {name}',
    en: 'Subscription: {name}',
  },
  'pdf.invoice.status': {
    fr: 'Statut : {status}',
    en: 'Status: {status}',
  },
  'pdf.invoice.paid': {
    fr: 'Payée',
    en: 'Paid',
  },
  'pdf.invoice.pending': {
    fr: 'En attente',
    en: 'Pending',
  },
  'pdf.invoice.description': {
    fr: 'Description',
    en: 'Description',
  },
  'pdf.invoice.amount': {
    fr: 'Montant',
    en: 'Amount',
  },
  'pdf.invoice.totalVat': {
    fr: 'TVA (20%)',
    en: 'VAT (20%)',
  },
  'pdf.invoice.totalTtc': {
    fr: 'Total TTC',
    en: 'Total incl. tax',
  },
  'pdf.invoice.paymentMethod': {
    fr: 'Mode de paiement',
    en: 'Payment method',
  },
  'pdf.invoice.providerStripe': {
    fr: 'Carte bancaire (Stripe)',
    en: 'Credit card (Stripe)',
  },
  'pdf.invoice.providerMvola': {
    fr: 'Mobile Money (MVola)',
    en: 'Mobile Money (MVola)',
  },
  'pdf.invoice.providerOrangeMoney': {
    fr: 'Mobile Money (Orange Money)',
    en: 'Mobile Money (Orange Money)',
  },
  'pdf.invoice.legalNotice': {
    fr: 'Mentions légales',
    en: 'Legal notice',
  },
  'pdf.invoice.legalInfo': {
    fr: 'LogiTrack Solutions — NIF : 4001234567 — STAT : 123456789011',
    en: 'LogiTrack Solutions — NIF: 4001234567 — STAT: 123456789011',
  },
  'pdf.invoice.legalAddress': {
    fr: 'Antananarivo 101 — Madagascar — TVA intracommunautaire non applicable, art. 259',
    en: 'Antananarivo 101 — Madagascar — VAT not applicable, art. 259',
  },
  'pdf.invoice.footer': {
    fr: 'DeliveryTrack — LogiTrack Solutions',
    en: 'DeliveryTrack — LogiTrack Solutions',
  },
  'pdf.invoice.thanks': {
    fr: 'Merci de votre confiance.',
    en: 'Thank you for your trust.',
  },
  'delivery.notification.title': {
    fr: 'Livraison {status}',
    en: 'Delivery {status}',
  },
  'delivery.notification.message': {
    fr: 'Livraison "{title}" est maintenant {status}',
    en: 'Delivery "{title}" is now {status}',
  },
  'delivery.notification.mismatchTitle': {
    fr: 'Écart de position détecté',
    en: 'Position mismatch detected',
  },
  'delivery.notification.mismatchMessage': {
    fr: 'Livraison "{title}" marquée à {distance} km du lieu prévu ({meters} m)',
    en: 'Delivery "{title}" marked at {distance} km from the planned location ({meters} m)',
  },
  'billing.paymentDescription': {
    fr: 'Abonnement {planName} — {interval}',
    en: '{planName} subscription — {interval}',
  },
  'billing.planNameNone': {
    fr: 'Aucun',
    en: 'None',
  },
  'invoice.planYearly': {
    fr: 'Annuel',
    en: 'Yearly',
  },
  'invoice.planMonthly': {
    fr: 'Mensuel',
    en: 'Monthly',
  },
};

export function t(
  key: string,
  lang: Language = 'fr',
  params?: Record<string, string | number>,
): string {
  const entry = translations[key];
  if (!entry) return key;
  let text = entry[lang] || entry.fr || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

export function formatDate(
  date: Date | string,
  lang: Language,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const locale = lang === 'en' ? 'en-US' : 'fr-FR';
  return d.toLocaleDateString(locale, options);
}

export function formatLongDate(date: Date | string, lang: Language): string {
  return formatDate(date, lang, { day: 'numeric', month: 'long', year: 'numeric' });
}
