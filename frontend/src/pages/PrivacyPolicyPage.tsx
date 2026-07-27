import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PrivacyPolicyPage.module.css';

export default function PrivacyPolicyPage() {
  const { t } = useTranslation();
  useEffect(() => { document.title = t('privacy.title'); }, []);

  return (
    <>
      <div className={styles.container}>
        <h1 className={styles.h1}>{t('privacy.title')}</h1>
        <p className={styles.updated}>{t('privacy.lastUpdated', { date: 'juillet 2026' })}</p>

        <h2 className={styles.h2}>{t('privacy.section1.title')}</h2>
        <p className={styles.p}>
          <strong>DeliveryTrack SARL</strong><br />
          Email : privacy@deliverytrack.app<br />
          Représentant légal : le gérant de DeliveryTrack SARL<br /><br />
          Conformément au Règlement Général sur la Protection des Données (RGPD — Règlement UE 2016/679)
          et à la loi malgache n°2014-038 sur la protection des données à caractère personnel.
        </p>

        <h2 className={styles.h2}>{t('privacy.section2.title')}</h2>

        <h3 className={styles.h3}>{t('privacy.section2.sub1')}</h3>
        <ul className={styles.ul}>
          <li className={styles.li}><strong>Données d'identification</strong> : nom, prénom, email, numéro de téléphone, mot de passe (haché)</li>
          <li className={styles.li}><strong>Données professionnelles</strong> : nom de l'entreprise, adresse, numéro de taxe</li>
          <li className={styles.li}><strong>Données de livraison</strong> : adresses de prise en charge et de livraison, coordonnées GPS</li>
          <li className={styles.li}><strong>Données de facturation</strong> : historique des abonnements, factures</li>
          <li className={styles.li}><strong>Données de profil</strong> : avatar, préférences de notification, thème</li>
        </ul>

        <h3 className={styles.h3}>{t('privacy.section2.sub2')}</h3>
        <ul className={styles.ul}>
          <li className={styles.li}><strong>Données de connexion</strong> : adresse IP, type de navigateur, système d'exploitation, pages visitées</li>
          <li className={styles.li}><strong>Cookies essentiels</strong> : token d'authentification, token CSRF (nécessaires au fonctionnement)</li>
          <li className={styles.li}><strong>Cookies d'analyse</strong> : si consentement donné, statistiques d'utilisation (Sentry)</li>
        </ul>

        <h2 className={styles.h2}>{t('privacy.section3.title')}</h2>
        <table className={styles.table}>
          <thead>
            <tr><th className={styles.th}>Finalité</th><th className={styles.th}>Base légale</th></tr>
          </thead>
          <tbody>
            <tr><td className={styles.td}>Fourniture du service de gestion de livraisons</td><td className={styles.td}>Exécution contractuelle (Art. 6.1.b)</td></tr>
            <tr><td className={styles.td}>Facturation et gestion des abonnements</td><td className={styles.td}>Exécution contractuelle (Art. 6.1.b)</td></tr>
            <tr><td className={styles.td}>Communication de support et technique</td><td className={styles.td}>Exécution contractuelle (Art. 6.1.b)</td></tr>
            <tr><td className={styles.td}>Respect des obligations légales (factures, audit)</td><td className={styles.td}>Obligation légale (Art. 6.1.c)</td></tr>
            <tr><td className={styles.td}>Amélioration du service et analyses</td><td className={styles.td}>Intérêt légitime (Art. 6.1.f) / Consentement (Art. 6.1.a)</td></tr>
            <tr><td className={styles.td}>Cookies non-essentiels</td><td className={styles.td}>Consentement (Art. 7 RGPD / Art. 82 Loi Informatique et Libertés)</td></tr>
          </tbody>
        </table>

        <h2 className={styles.h2}>{t('privacy.section4.title')}</h2>
        <p className={styles.p}>Vos données peuvent être transmises aux catégories de destinataires suivantes :</p>
        <ul className={styles.ul}>
          <li className={styles.li}><strong>Hébergeur</strong> : OVHcloud / Scaleway (UE) — données hébergées en France</li>
          <li className={styles.li}><strong>Prestataire de paiement</strong> : Stripe — données de facturation (aucun numéro de carte stocké)</li>
          <li className={styles.li}><strong>Service d'email</strong> : Resend — notifications et emails transactionnels</li>
          <li className={styles.li}><strong>Service d'erreurs</strong> : Sentry — journaux d'erreurs (anonymisés)</li>
          <li className={styles.li}><strong>Autorités légales</strong> : sur requête judiciaire dûment motivée</li>
        </ul>
        <p className={styles.p}>Chaque sous-traitant est lié par contrat (DPA) conforme à l'Art. 28 RGPD.</p>

        <h2 className={styles.h2}>{t('privacy.section5.title')}</h2>
        <p className={styles.p}>
          Les données sont hébergées dans l'Union Européenne. Certains sous-traitants (Stripe, Sentry) peuvent
          transférer des données aux États-Unis dans le cadre du <strong>Data Privacy Framework</strong> (DPF) ou
          de <strong>Clauses Contractuelles Types</strong> (CCT) approuvées par la Commission européenne.
        </p>

        <h2 className={styles.h2}>{t('privacy.section6.title')}</h2>
        <table className={styles.table}>
          <thead>
            <tr><th className={styles.th}>Catégorie</th><th className={styles.th}>Durée</th></tr>
          </thead>
          <tbody>
            <tr><td className={styles.td}>Compte utilisateur actif</td><td className={styles.td}>Toute la durée du contrat + 30 jours après résiliation</td></tr>
            <tr><td className={styles.td}>Données de livraison (adresses, GPS)</td><td className={styles.td}>3 ans après la livraison (garantie légale)</td></tr>
            <tr><td className={styles.td}>Factures et données comptables</td><td className={styles.td}>10 ans (obligation légale)</td></tr>
            <tr><td className={styles.td}>Journaux de connexion</td><td className={styles.td}>1 an</td></tr>
            <tr><td className={styles.td}>Cookies d'authentification</td><td className={styles.td}>Session ou 7 jours max</td></tr>
          </tbody>
        </table>

        <h2 className={styles.h2}>{t('privacy.section7.title')}</h2>
        <p className={styles.p}>Conformément aux articles 15 à 22 du RGPD, vous disposez des droits suivants :</p>
        <ul className={styles.ul}>
          <li className={styles.li}><strong>Droit d'accès</strong> (Art. 15) : obtenir une copie de vos données</li>
          <li className={styles.li}><strong>Droit de rectification</strong> (Art. 16) : corriger vos données inexactes</li>
          <li className={styles.li}><strong>Droit à l'effacement</strong> (Art. 17) : demander la suppression de vos données (droit à l'oubli)</li>
          <li className={styles.li}><strong>Droit à la limitation</strong> (Art. 18) : limiter le traitement de vos données</li>
          <li className={styles.li}><strong>Droit à la portabilité</strong> (Art. 20) : recevoir vos données dans un format structuré (JSON)</li>
          <li className={styles.li}><strong>Droit d'opposition</strong> (Art. 21) : vous opposer au traitement pour l'intérêt légitime</li>
        </ul>
        <p className={styles.p}>
          Pour exercer vos droits, connectez-vous à votre compte et utilisez les outils dédiés dans les paramètres,
          ou contactez-nous à <strong>privacy@deliverytrack.app</strong>. Nous répondons sous 30 jours maximum.
        </p>

        <h2 className={styles.h2}>{t('privacy.section8.title')}</h2>
        <ul className={styles.ul}>
          <li className={styles.li}>Chiffrement HTTPS/TLS en transit (HSTS activé)</li>
          <li className={styles.li}>Mots de passe hachés avec bcrypt (12 rounds)</li>
          <li className={styles.li}>Authentification 2FA disponible</li>
          <li className={styles.li}>Protection CSRF par jeton signé HMAC</li>
          <li className={styles.li}>Rate limiting sur les endpoints sensibles</li>
          <li className={styles.li}>Journaux d'audit traçant les accès aux données</li>
          <li className={styles.li}>Accès basé sur les rôles (RBAC) avec isolation compagnie</li>
        </ul>

        <h2 className={styles.h2}>{t('privacy.section9.title')}</h2>
        <p className={styles.p}>
           {t('privacy.cookiesLink')} <a className={styles.link} href="/cookies">{t('privacy.cookies')}</a> {t('privacy.cookiesDesc')}
          plus d'informations sur les cookies utilisés et comment les gérer.
        </p>

        <h2 className={styles.h2}>{t('privacy.section10.title')}</h2>
        <p className={styles.p}>
          Si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une réclamation auprès
          de l'autorité de contrôle compétente (CNIL en France ou autorité malgache compétente).
        </p>

        <h2 className={styles.h2}>{t('privacy.section11.title')}</h2>
        <p className={styles.p}>
          Pour toute question relative à la protection des données :<br />
          Email : <strong>privacy@deliverytrack.app</strong><br />
          Adresse : DeliveryTrack SARL, Tananarive, Madagascar
        </p>
      </div>
    </>
  );
}
