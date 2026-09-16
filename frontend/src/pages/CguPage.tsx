import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import styles from './CguPage.module.css';

export default function CguPage() {
  const { t } = useTranslation();
  return (
    <div className={styles.outer}>
      <div className={styles.inner}>
        <Link to="/register" className={styles.backLink}>
          <ArrowLeft size={14} /> {t('cgu.backToRegister')}
        </Link>

        <h1 className={styles.title}>
          {t('cgu.title')}
        </h1>
        <p className={styles.lastUpdated}>
          {t('cgu.lastUpdated', { date: 'septembre 2026' })}
        </p>

        <div className={styles.section}>
          <h2 className={styles.heading}>{t('cgu.section1.title')}</h2>
          <p className={styles.paragraph}>
            Les présentes Conditions Générales d'Utilisation (ci-après « CGU ») régissent l'accès et l'utilisation
            de la plateforme LogiTrack (ci-après « la Plateforme »), éditée par la société LogiTrack SARL.
          </p>
          <p className={styles.alert}>
            <strong>Essai gratuit :</strong> LogiTrack propose un essai gratuit de 14 jours à la création
            du compte, avec accès complet aux fonctionnalités du forfait Business, sans carte bancaire ni
            engagement. À l'issue de cette période, l'accès à la Plateforme est soumis à la souscription
            d'un forfait payant, décrit à l'article 9 des présentes CGU.
          </p>
          <p className={styles.paragraph}>
            En créant un compte et en utilisant la Plateforme, vous acceptez sans réserve les présentes CGU.
            Si vous n'acceptez pas ces conditions, veuillez ne pas utiliser la Plateforme.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.heading}>{t('cgu.section2.title')}</h2>
          <p className={styles.paragraph}>
            <strong>Client</strong> : toute personne morale ou physique inscrite sur la Plateforme en tant qu'utilisateur.
          </p>
          <p className={styles.paragraph}>
            <strong>Données</strong> : l'ensemble des informations relatives aux livraisons, positions GPS,
            véhicules et utilisateurs traitées via la Plateforme.
          </p>
          <p className={styles.paragraph}>
            <strong>Essai gratuit</strong> : période de 14 jours suivant la création du compte, durant
            laquelle l'ensemble des fonctionnalités du forfait Business est accessible sans frais. Les
            conditions applicables à l'issue de l'essai sont décrites à l'article 9 des présentes CGU.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.heading}>{t('cgu.section3.title')}</h2>
          <p className={styles.paragraph}>
            3.1. La création d'un compte est nécessaire pour accéder aux fonctionnalités de la Plateforme.
            L'utilisateur s'engage à fournir des informations exactes et à les maintenir à jour.
          </p>
          <p className={styles.paragraph}>
            3.2. LogiTrack se réserve le droit de suspendre ou résilier tout compte en cas de violation
            des présentes CGU ou d'utilisation frauduleuse de la Plateforme.
          </p>
          <p className={styles.paragraph}>
            3.3. L'utilisateur est seul responsable de la confidentialité de ses identifiants de connexion.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.heading}>{t('cgu.section4.title')}</h2>
          <p className={styles.paragraph}>
            LogiTrack propose une solution de gestion et de suivi de livraisons comprenant notamment :
          </p>
          <ul className={styles.list}>
            <li>Suivi GPS en temps réel des livreurs et véhicules</li>
            <li>Gestion des tournées et optimisation d'itinéraires</li>
            <li>Tableaux de bord et rapports d'activité</li>
            <li>Gestion de flotte et consommation de carburant</li>
            <li>Notifications en temps réel</li>
            <li>Portail client de suivi de livraisons</li>
          </ul>
          <p className={styles.paragraph}>
            Pendant l'essai gratuit de 14 jours, l'ensemble des fonctionnalités listées ci-dessus est
            accessible sans frais, au niveau du forfait Business.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.heading}>{t('cgu.section5.title')}</h2>
          <p className={styles.paragraph}>
            5.1. L'utilisateur s'engage à utiliser la Plateforme conformément aux lois et réglementations en vigueur,
            notamment la loi n° 2016-20 du 28 juin 2016 sur la protection des données à caractère personnel
            et le Règlement Général sur la Protection des Données (RGPD).
          </p>
          <p className={styles.paragraph}>
            5.2. L'utilisateur garantit qu'il dispose des droits nécessaires sur les données qu'il importe
            ou traite via la Plateforme.
          </p>
          <p className={styles.paragraph}>
            5.3. Il est interdit d'utiliser la Plateforme à des fins illicites, de porter atteinte à son
            fonctionnement ou de tenter d'y accéder par des moyens non autorisés.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.heading}>{t('cgu.section6.title')}</h2>
          <p className={styles.paragraph}>
           6.1. LogiTrack s'engage à protéger les données personnelles de ses utilisateurs conformément
               à sa <Link to="/privacy" className={styles.privacyLink}>{t('cgu.privacyPolicy')}</Link>.
          </p>
          <p className={styles.paragraph}>
            6.2. Les données de localisation collectées via la Plateforme sont utilisées uniquement dans le cadre
            du suivi des livraisons et ne sont pas revendues à des tiers.
          </p>
          <p className={styles.paragraph}>
            6.3. Chaque utilisateur est responsable du traitement des données qu'il réalise via la Plateforme
            et s'engage à respecter les droits des personnes concernées (livreurs, clients finaux, etc.).
          </p>
          <p className={styles.paragraph}>
            6.4. Les données sont hébergées sur des serveurs sécurisés situés dans l'Union Européenne.
            LogiTrack met en œuvre des mesures techniques et organisationnelles appropriées pour garantir
            la sécurité et la confidentialité des données.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.heading}>{t('cgu.section7.title')}</h2>
          <p className={styles.paragraph}>
            L'ensemble des éléments composant la Plateforme (design, code source, marques, logos) est
            la propriété exclusive de LogiTrack SARL. Toute reproduction ou utilisation sans autorisation
            est interdite.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.heading}>{t('cgu.section8.title')}</h2>
          <p className={styles.paragraph}>
            8.1. LogiTrack met en œuvre les moyens raisonnables pour assurer un fonctionnement continu
            de la Plateforme, sans garantie absolue de disponibilité.
          </p>
          <p className={styles.paragraph}>
            8.2. LogiTrack ne saurait être tenu responsable des dommages indirects résultant de
            l'utilisation ou de l'impossibilité d'utiliser la Plateforme.
          </p>
          <p className={styles.paragraph}>
            8.3. Les données de localisation GPS sont fournies à titre indicatif. LogiTrack ne garantit pas
            l'exactitude en temps réel des positions et ne peut être tenu responsable des décisions prises
            sur la base de ces informations.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.heading}>{t('cgu.section9.title')}</h2>
          <p className={styles.paragraph}>
            9.1. Tout nouveau compte bénéficie d'un essai gratuit de 14 jours, avec accès complet aux
            fonctionnalités du forfait Business, sans carte bancaire ni engagement.
          </p>
          <p className={styles.paragraph}>
            9.2. À l'issue de l'essai gratuit, l'accès à la Plateforme nécessite la souscription à l'un des
            forfaits payants suivants (tarifs mensuels, en Ariary) : Simple (35 000 Ar), Pro (90 000 Ar) et
            Business (200 000 Ar). Le détail des fonctionnalités incluses dans chaque forfait est présenté
            sur la Plateforme.
          </p>
          <p className={styles.paragraph}>
            9.3. Le paiement s'effectue par Mobile Money, auprès des numéros communiqués sur la Plateforme.
            L'utilisateur doit soumettre une preuve de paiement (capture d'écran et référence de transaction)
            directement depuis l'application.
          </p>
          <p className={styles.paragraph}>
            9.4. Chaque preuve de paiement est vérifiée manuellement par LogiTrack. Une fois validée, un code
            d'activation est communiqué à l'utilisateur pour réactiver ou renouveler l'accès à la Plateforme.
          </p>
          <p className={styles.paragraph}>
            9.5. À défaut de paiement validé à l'issue de l'essai gratuit ou de la période payante en cours,
            l'accès à la Plateforme est suspendu immédiatement et intégralement, jusqu'à réception et
            validation d'un nouveau paiement.
          </p>
          <p className={styles.paragraph}>
            9.6. LogiTrack se réserve le droit de modifier ses tarifs à tout moment. Les utilisateurs déjà
            abonnés en seront informés avec un préavis raisonnable avant toute application à leur forfait en cours.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.heading}>{t('cgu.section10.title')}</h2>
          <p className={styles.paragraph}>
            L'utilisateur peut résilier son compte à tout moment depuis les paramètres de son profil.
            Les données seront conservées pendant une période de 30 jours après la résiliation,
            puis définitivement supprimées.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.heading}>{t('cgu.section11.title')}</h2>
          <p className={styles.paragraph}>
            Les présentes CGU sont soumises au droit malgache. Tout litige relatif à leur interprétation
            ou exécution relève de la compétence des tribunaux de Tananarive.
          </p>
        </div>

        <div className={styles.section}>
          <h2 className={styles.heading}>{t('cgu.section12.title')}</h2>
          <p className={styles.paragraph}>
            Pour toute question relative aux présentes CGU, vous pouvez nous contacter à l'adresse suivante :
          </p>
          <p className={styles.paragraph}>
            LogiTrack SARL<br />
            Email : support@deliverytrack.app<br />
          </p>
        </div>
      </div>
    </div>
  );
}
