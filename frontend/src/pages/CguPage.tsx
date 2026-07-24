import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const section: React.CSSProperties = {
  marginBottom: 32,
};

const heading: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: '#111827',
  marginBottom: 12,
};

const paragraph: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.7,
  color: '#4b5563',
  marginBottom: 12,
};

export default function CguPage() {
  const { t } = useTranslation();
  return (
    <div style={{
      minHeight: '100vh',
      background: '#f8fafc',
    }}>
      <div style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '40px 24px 80px',
      }}>
        <Link to="/register" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 13, color: '#6b7280', textDecoration: 'none', marginBottom: 32,
        }}>
          <ArrowLeft size={14} /> {t('cgu.backToRegister')}
        </Link>

        <h1 style={{
          fontSize: 28, fontWeight: 700, color: '#111827', marginBottom: 8,
        }}>
          {t('cgu.title')}
        </h1>
        <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 40 }}>
          {t('cgu.lastUpdated', { date: 'juillet 2026' })}
        </p>

        <div style={section}>
          <h2 style={heading}>{t('cgu.section1.title')}</h2>
          <p style={paragraph}>
            Les présentes Conditions Générales d'Utilisation (ci-après « CGU ») régissent l'accès et l'utilisation
            de la plateforme DeliveryTrack (ci-après « la Plateforme »), éditée par la société DeliveryTrack SARL.
          </p>
          <p style={paragraph}>
            En créant un compte et en utilisant la Plateforme, vous acceptez sans réserve les présentes CGU.
            Si vous n'acceptez pas ces conditions, veuillez ne pas utiliser la Plateforme.
          </p>
        </div>

        <div style={section}>
          <h2 style={heading}>{t('cgu.section2.title')}</h2>
          <p style={paragraph}>
            <strong>Client</strong> : toute personne morale ou physique inscrite sur la Plateforme en tant qu'utilisateur.
          </p>
          <p style={paragraph}>
            <strong>Données</strong> : l'ensemble des informations relatives aux livraisons, positions GPS,
            véhicules et utilisateurs traitées via la Plateforme.
          </p>
          <p style={paragraph}>
            <strong>Abonnement</strong> : formule payante donnant accès à des fonctionnalités étendues de la Plateforme
            selon les modalités décrites sur la page de tarification.
          </p>
        </div>

        <div style={section}>
          <h2 style={heading}>{t('cgu.section3.title')}</h2>
          <p style={paragraph}>
            3.1. La création d'un compte est nécessaire pour accéder aux fonctionnalités de la Plateforme.
            L'utilisateur s'engage à fournir des informations exactes et à les maintenir à jour.
          </p>
          <p style={paragraph}>
            3.2. DeliveryTrack se réserve le droit de suspendre ou résilier tout compte en cas de violation
            des présentes CGU ou d'utilisation frauduleuse de la Plateforme.
          </p>
          <p style={paragraph}>
            3.3. L'utilisateur est seul responsable de la confidentialité de ses identifiants de connexion.
          </p>
        </div>

        <div style={section}>
          <h2 style={heading}>{t('cgu.section4.title')}</h2>
          <p style={paragraph}>
            DeliveryTrack propose une solution de gestion et de suivi de livraisons comprenant notamment :
          </p>
          <ul style={{ ...paragraph, paddingLeft: 20 }}>
            <li>Suivi GPS en temps réel des livreurs et véhicules</li>
            <li>Gestion des tournées et optimisation d'itinéraires</li>
            <li>Tableaux de bord et rapports d'activité</li>
            <li>Gestion de flotte et consommation de carburant</li>
            <li>Notifications en temps réel</li>
            <li>Portail client de suivi de livraisons</li>
          </ul>
          <p style={paragraph}>
            Les fonctionnalités accessibles dépendent du type d'abonnement souscrit par l'utilisateur.
          </p>
        </div>

        <div style={section}>
          <h2 style={heading}>{t('cgu.section5.title')}</h2>
          <p style={paragraph}>
            5.1. L'utilisateur s'engage à utiliser la Plateforme conformément aux lois et réglementations en vigueur,
            notamment la loi n° 2016-20 du 28 juin 2016 sur la protection des données à caractère personnel
            et le Règlement Général sur la Protection des Données (RGPD).
          </p>
          <p style={paragraph}>
            5.2. L'utilisateur garantit qu'il dispose des droits nécessaires sur les données qu'il importe
            ou traite via la Plateforme.
          </p>
          <p style={paragraph}>
            5.3. Il est interdit d'utiliser la Plateforme à des fins illicites, de porter atteinte à son
            fonctionnement ou de tenter d'y accéder par des moyens non autorisés.
          </p>
        </div>

        <div style={section}>
          <h2 style={heading}>{t('cgu.section6.title')}</h2>
          <p style={paragraph}>
          6.1. DeliveryTrack s'engage à protéger les données personnelles de ses utilisateurs conformément
              à sa <Link to="/privacy" style={{ color: '#2563eb', textDecoration: 'underline' }}>{t('cgu.privacyPolicy')}</Link>.
          </p>
          <p style={paragraph}>
            6.2. Les données de localisation collectées via la Plateforme sont utilisées uniquement dans le cadre
            du suivi des livraisons et ne sont pas revendues à des tiers.
          </p>
          <p style={paragraph}>
            6.3. Chaque utilisateur est responsable du traitement des données qu'il réalise via la Plateforme
            et s'engage à respecter les droits des personnes concernées (livreurs, clients finaux, etc.).
          </p>
          <p style={paragraph}>
            6.4. Les données sont hébergées sur des serveurs sécurisés situés dans l'Union Européenne.
            DeliveryTrack met en œuvre des mesures techniques et organisationnelles appropriées pour garantir
            la sécurité et la confidentialité des données.
          </p>
        </div>

        <div style={section}>
          <h2 style={heading}>{t('cgu.section7.title')}</h2>
          <p style={paragraph}>
            L'ensemble des éléments composant la Plateforme (design, code source, marques, logos) est
            la propriété exclusive de DeliveryTrack SARL. Toute reproduction ou utilisation sans autorisation
            est interdite.
          </p>
        </div>

        <div style={section}>
          <h2 style={heading}>{t('cgu.section8.title')}</h2>
          <p style={paragraph}>
            8.1. DeliveryTrack met en œuvre les moyens raisonnables pour assurer un fonctionnement continu
            de la Plateforme, sans garantie absolue de disponibilité.
          </p>
          <p style={paragraph}>
            8.2. DeliveryTrack ne saurait être tenu responsable des dommages indirects résultant de
            l'utilisation ou de l'impossibilité d'utiliser la Plateforme.
          </p>
          <p style={paragraph}>
            8.3. Les données de localisation GPS sont fournies à titre indicatif. DeliveryTrack ne garantit pas
            l'exactitude en temps réel des positions et ne peut être tenu responsable des décisions prises
            sur la base de ces informations.
          </p>
        </div>

        <div style={section}>
          <h2 style={heading}>{t('cgu.section9.title')}</h2>
          <p style={paragraph}>
            9.1. Les tarifs des abonnements sont indiqués sur la page de tarification de la Plateforme.
            DeliveryTrack se réserve le droit de modifier ses tarifs à tout moment, sous réserve
            d'une information préalable de 30 jours.
          </p>
          <p style={paragraph}>
            9.2. La facturation est effectuée mensuellement ou annuellement selon l'option choisie.
            Le non-paiement entraîne la suspension de l'accès à la Plateforme après une période de grâce
            de 15 jours.
          </p>
        </div>

        <div style={section}>
          <h2 style={heading}>{t('cgu.section10.title')}</h2>
          <p style={paragraph}>
            L'utilisateur peut résilier son compte à tout moment depuis les paramètres de son profil.
            Les données seront conservées pendant une période de 30 jours après la résiliation,
            puis définitivement supprimées.
          </p>
        </div>

        <div style={section}>
          <h2 style={heading}>{t('cgu.section11.title')}</h2>
          <p style={paragraph}>
            Les présentes CGU sont soumises au droit malgache. Tout litige relatif à leur interprétation
            ou exécution relève de la compétence des tribunaux de Tananarive.
          </p>
        </div>

        <div style={section}>
          <h2 style={heading}>{t('cgu.section12.title')}</h2>
          <p style={paragraph}>
            Pour toute question relative aux présentes CGU, vous pouvez nous contacter à l'adresse suivante :
          </p>
          <p style={paragraph}>
            DeliveryTrack SARL<br />
            Email : support@deliverytrack.app<br />
          </p>
        </div>
      </div>
    </div>
  );
}
