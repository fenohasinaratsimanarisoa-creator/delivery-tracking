import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const styles = {
  container: {
    maxWidth: 800, margin: '0 auto', padding: 'var(--space-4xl) var(--space-lg)',
    fontFamily: 'var(--font-body)', color: 'var(--color-text)', lineHeight: 1.7,
  },
  h1: { fontSize: 'var(--text-3xl)', fontWeight: 700, marginBottom: 'var(--space-md)' },
  h2: { fontSize: 'var(--text-xl)', fontWeight: 600, marginTop: 'var(--space-2xl)', marginBottom: 'var(--space-sm)' },
  h3: { fontSize: 'var(--text-lg)', fontWeight: 600, marginTop: 'var(--space-xl)', marginBottom: 'var(--space-sm)' },
  p: { marginBottom: 'var(--space-md)' },
  ul: { marginBottom: 'var(--space-md)', paddingLeft: 'var(--space-xl)' },
  li: { marginBottom: 'var(--space-xs)' },
  updated: { color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-xl)' },
  table: { width: '100%', borderCollapse: 'collapse' as const, marginBottom: 'var(--space-md)' },
  th: { border: '1px solid var(--color-border)', padding: 'var(--space-sm) var(--space-md)', background: 'var(--color-surface-alt)', textAlign: 'left' as const, fontWeight: 600 },
  td: { border: '1px solid var(--color-border)', padding: 'var(--space-sm) var(--space-md)' },
};

export default function PrivacyPolicyPage() {
  const { t } = useTranslation();
  useEffect(() => { document.title = t('privacy.title'); }, []);

  return (
    <>
      <div style={styles.container}>
        <h1 style={styles.h1}>{t('privacy.title')}</h1>
        <p style={styles.updated}>{t('privacy.lastUpdated', { date: 'juillet 2026' })}</p>

        <h2 style={styles.h2}>{t('privacy.section1.title')}</h2>
        <p style={styles.p}>
          <strong>DeliveryTrack SARL</strong><br />
          Email : privacy@deliverytrack.app<br />
          Représentant légal : le gérant de DeliveryTrack SARL<br /><br />
          Conformément au Règlement Général sur la Protection des Données (RGPD — Règlement UE 2016/679)
          et à la loi malgache n°2014-038 sur la protection des données à caractère personnel.
        </p>

        <h2 style={styles.h2}>{t('privacy.section2.title')}</h2>

        <h3 style={styles.h3}>{t('privacy.section2.sub1')}</h3>
        <ul style={styles.ul}>
          <li style={styles.li}><strong>Données d'identification</strong> : nom, prénom, email, numéro de téléphone, mot de passe (haché)</li>
          <li style={styles.li}><strong>Données professionnelles</strong> : nom de l'entreprise, adresse, numéro de taxe</li>
          <li style={styles.li}><strong>Données de livraison</strong> : adresses de prise en charge et de livraison, coordonnées GPS</li>
          <li style={styles.li}><strong>Données de facturation</strong> : historique des abonnements, factures</li>
          <li style={styles.li}><strong>Données de profil</strong> : avatar, préférences de notification, thème</li>
        </ul>

        <h3 style={styles.h3}>{t('privacy.section2.sub2')}</h3>
        <ul style={styles.ul}>
          <li style={styles.li}><strong>Données de connexion</strong> : adresse IP, type de navigateur, système d'exploitation, pages visitées</li>
          <li style={styles.li}><strong>Cookies essentiels</strong> : token d'authentification, token CSRF (nécessaires au fonctionnement)</li>
          <li style={styles.li}><strong>Cookies d'analyse</strong> : si consentement donné, statistiques d'utilisation (Sentry)</li>
        </ul>

        <h2 style={styles.h2}>{t('privacy.section3.title')}</h2>
        <table style={styles.table}>
          <thead>
            <tr><th style={styles.th}>Finalité</th><th style={styles.th}>Base légale</th></tr>
          </thead>
          <tbody>
            <tr><td style={styles.td}>Fourniture du service de gestion de livraisons</td><td style={styles.td}>Exécution contractuelle (Art. 6.1.b)</td></tr>
            <tr><td style={styles.td}>Facturation et gestion des abonnements</td><td style={styles.td}>Exécution contractuelle (Art. 6.1.b)</td></tr>
            <tr><td style={styles.td}>Communication de support et technique</td><td style={styles.td}>Exécution contractuelle (Art. 6.1.b)</td></tr>
            <tr><td style={styles.td}>Respect des obligations légales (factures, audit)</td><td style={styles.td}>Obligation légale (Art. 6.1.c)</td></tr>
            <tr><td style={styles.td}>Amélioration du service et analyses</td><td style={styles.td}>Intérêt légitime (Art. 6.1.f) / Consentement (Art. 6.1.a)</td></tr>
            <tr><td style={styles.td}>Cookies non-essentiels</td><td style={styles.td}>Consentement (Art. 7 RGPD / Art. 82 Loi Informatique et Libertés)</td></tr>
          </tbody>
        </table>

        <h2 style={styles.h2}>{t('privacy.section4.title')}</h2>
        <p style={styles.p}>Vos données peuvent être transmises aux catégories de destinataires suivantes :</p>
        <ul style={styles.ul}>
          <li style={styles.li}><strong>Hébergeur</strong> : OVHcloud / Scaleway (UE) — données hébergées en France</li>
          <li style={styles.li}><strong>Prestataire de paiement</strong> : Stripe — données de facturation (aucun numéro de carte stocké)</li>
          <li style={styles.li}><strong>Service d'email</strong> : Resend — notifications et emails transactionnels</li>
          <li style={styles.li}><strong>Service d'erreurs</strong> : Sentry — journaux d'erreurs (anonymisés)</li>
          <li style={styles.li}><strong>Autorités légales</strong> : sur requête judiciaire dûment motivée</li>
        </ul>
        <p style={styles.p}>Chaque sous-traitant est lié par contrat (DPA) conforme à l'Art. 28 RGPD.</p>

        <h2 style={styles.h2}>{t('privacy.section5.title')}</h2>
        <p style={styles.p}>
          Les données sont hébergées dans l'Union Européenne. Certains sous-traitants (Stripe, Sentry) peuvent
          transférer des données aux États-Unis dans le cadre du <strong>Data Privacy Framework</strong> (DPF) ou
          de <strong>Clauses Contractuelles Types</strong> (CCT) approuvées par la Commission européenne.
        </p>

        <h2 style={styles.h2}>{t('privacy.section6.title')}</h2>
        <table style={styles.table}>
          <thead>
            <tr><th style={styles.th}>Catégorie</th><th style={styles.th}>Durée</th></tr>
          </thead>
          <tbody>
            <tr><td style={styles.td}>Compte utilisateur actif</td><td style={styles.td}>Toute la durée du contrat + 30 jours après résiliation</td></tr>
            <tr><td style={styles.td}>Données de livraison (adresses, GPS)</td><td style={styles.td}>3 ans après la livraison (garantie légale)</td></tr>
            <tr><td style={styles.td}>Factures et données comptables</td><td style={styles.td}>10 ans (obligation légale)</td></tr>
            <tr><td style={styles.td}>Journaux de connexion</td><td style={styles.td}>1 an</td></tr>
            <tr><td style={styles.td}>Cookies d'authentification</td><td style={styles.td}>Session ou 7 jours max</td></tr>
          </tbody>
        </table>

        <h2 style={styles.h2}>{t('privacy.section7.title')}</h2>
        <p style={styles.p}>Conformément aux articles 15 à 22 du RGPD, vous disposez des droits suivants :</p>
        <ul style={styles.ul}>
          <li style={styles.li}><strong>Droit d'accès</strong> (Art. 15) : obtenir une copie de vos données</li>
          <li style={styles.li}><strong>Droit de rectification</strong> (Art. 16) : corriger vos données inexactes</li>
          <li style={styles.li}><strong>Droit à l'effacement</strong> (Art. 17) : demander la suppression de vos données (droit à l'oubli)</li>
          <li style={styles.li}><strong>Droit à la limitation</strong> (Art. 18) : limiter le traitement de vos données</li>
          <li style={styles.li}><strong>Droit à la portabilité</strong> (Art. 20) : recevoir vos données dans un format structuré (JSON)</li>
          <li style={styles.li}><strong>Droit d'opposition</strong> (Art. 21) : vous opposer au traitement pour l'intérêt légitime</li>
        </ul>
        <p style={styles.p}>
          Pour exercer vos droits, connectez-vous à votre compte et utilisez les outils dédiés dans les paramètres,
          ou contactez-nous à <strong>privacy@deliverytrack.app</strong>. Nous répondons sous 30 jours maximum.
        </p>

        <h2 style={styles.h2}>{t('privacy.section8.title')}</h2>
        <ul style={styles.ul}>
          <li style={styles.li}>Chiffrement HTTPS/TLS en transit (HSTS activé)</li>
          <li style={styles.li}>Mots de passe hachés avec bcrypt (12 rounds)</li>
          <li style={styles.li}>Authentification 2FA disponible</li>
          <li style={styles.li}>Protection CSRF par jeton signé HMAC</li>
          <li style={styles.li}>Rate limiting sur les endpoints sensibles</li>
          <li style={styles.li}>Journaux d'audit traçant les accès aux données</li>
          <li style={styles.li}>Accès basé sur les rôles (RBAC) avec isolation compagnie</li>
        </ul>

        <h2 style={styles.h2}>{t('privacy.section9.title')}</h2>
        <p style={styles.p}>
           {t('privacy.cookiesLink')} <a href="/cookies" style={{ color: 'var(--color-accent)' }}>{t('privacy.cookies')}</a> {t('privacy.cookiesDesc')}
          plus d'informations sur les cookies utilisés et comment les gérer.
        </p>

        <h2 style={styles.h2}>{t('privacy.section10.title')}</h2>
        <p style={styles.p}>
          Si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une réclamation auprès
          de l'autorité de contrôle compétente (CNIL en France ou autorité malgache compétente).
        </p>

        <h2 style={styles.h2}>{t('privacy.section11.title')}</h2>
        <p style={styles.p}>
          Pour toute question relative à la protection des données :<br />
          Email : <strong>privacy@deliverytrack.app</strong><br />
          Adresse : DeliveryTrack SARL, Tananarive, Madagascar
        </p>
      </div>
    </>
  );
}
