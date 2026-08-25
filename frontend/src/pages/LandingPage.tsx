import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Radar, Truck, Fuel, ArrowRight, Check, Gauge } from 'lucide-react';
import Button from '../components/Button';
import Card from '../components/Card';
import Badge from '../components/Badge';
import styles from './LandingPage.module.css';

interface FeatureItem {
  title: string;
  desc: string;
}

interface PricingTier {
  name: string;
  price: string;
  period: string;
  desc: string;
  features: string[];
  cta: string;
  highlighted: boolean;
}

const FEATURE_ICONS = [ShieldCheck, Radar, Truck, Fuel];

export default function LandingPage() {
  const { t } = useTranslation();
  const features = t('landing.features.items', { returnObjects: true }) as FeatureItem[];
  const tiers = t('landing.pricing.tiers', { returnObjects: true }) as PricingTier[];
  const year = new Date().getFullYear();

  return (
    <div className={styles.root}>
      <header className={styles.nav}>
        <div className={styles.navInner}>
          <span className={styles.logo}>
            <span className={styles.logoMark}><Gauge size={16} /></span>
            LogiTrack
          </span>
          <nav className={styles.navLinks}>
            <a href="#features">{t('landing.nav.features')}</a>
            <a href="#pricing">{t('landing.nav.pricing')}</a>
          </nav>
          <div className={styles.navActions}>
            <Link to="/login" className={styles.navLoginLink}>{t('landing.nav.login')}</Link>
            <Link to="/register">
              <Button variant="primary" size="sm">{t('landing.nav.getStarted')}</Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className={styles.hero}>
          <span className={styles.heroEyebrow}>{t('landing.hero.eyebrow')}</span>
          <h1 className={styles.heroTitle}>{t('landing.hero.title')}</h1>
          <p className={styles.heroSubtitle}>{t('landing.hero.subtitle')}</p>
          <div className={styles.heroActions}>
            <Link to="/register">
              <Button variant="primary" size="lg" icon={<ArrowRight size={18} />}>
                {t('landing.hero.ctaPrimary')}
              </Button>
            </Link>
            <Link to="/login">
              <Button variant="secondary" size="lg">{t('landing.hero.ctaSecondary')}</Button>
            </Link>
          </div>
          <span className={styles.heroTrust}>{t('landing.hero.trustNote')}</span>

          <div className={styles.heroGlow} aria-hidden="true" />
        </section>

        <section id="features" className={styles.features}>
          <span className={styles.sectionEyebrow}>{t('landing.features.eyebrow')}</span>
          <h2 className={styles.sectionTitle}>{t('landing.features.title')}</h2>
          <div className={styles.featureGrid}>
            {features.map((f, i) => {
              const Icon = FEATURE_ICONS[i] ?? ShieldCheck;
              return (
                <Card key={f.title} animated hoverable style={{ animationDelay: `${i * 60}ms` }}>
                  <span className={styles.featureIcon}><Icon size={20} /></span>
                  <h3 className={styles.featureTitle}>{f.title}</h3>
                  <p className={styles.featureDesc}>{f.desc}</p>
                </Card>
              );
            })}
          </div>
        </section>

        <section id="pricing" className={styles.pricing}>
          <span className={styles.sectionEyebrow}>{t('landing.pricing.eyebrow')}</span>
          <h2 className={styles.sectionTitle}>{t('landing.pricing.title')}</h2>
          <p className={styles.pricingSubtitle}>{t('landing.pricing.subtitle')}</p>
          <div className={styles.pricingGrid}>
            {tiers.map((tier) => (
              <Card
                key={tier.name}
                className={tier.highlighted ? styles.pricingCardHighlighted : styles.pricingCard}
                footer={
                  <Link to="/register" className={styles.pricingCtaLink}>
                    <Button variant={tier.highlighted ? 'primary' : 'secondary'} fullWidth>
                      {tier.cta}
                    </Button>
                  </Link>
                }
              >
                {tier.highlighted && <Badge variant="accent">{t('landing.nav.getStarted')}</Badge>}
                <h3 className={styles.pricingTierName}>{tier.name}</h3>
                <div className={styles.pricingPrice}>
                  {tier.price}
                  {tier.period && <span className={styles.pricingPeriod}>{tier.period}</span>}
                </div>
                <p className={styles.pricingDesc}>{tier.desc}</p>
                <ul className={styles.pricingFeatureList}>
                  {tier.features.map((feat) => (
                    <li key={feat}><Check size={14} /> {feat}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
          <p className={styles.pricingNote}>{t('landing.pricing.note')}</p>
        </section>

        <section className={styles.cta}>
          <h2 className={styles.ctaTitle}>{t('landing.cta.title')}</h2>
          <p className={styles.ctaSubtitle}>{t('landing.cta.subtitle')}</p>
          <Link to="/register">
            <Button variant="primary" size="lg" icon={<ArrowRight size={18} />}>
              {t('landing.cta.button')}
            </Button>
          </Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <span className={styles.logo}>
              <span className={styles.logoMark}><Gauge size={16} /></span>
              LogiTrack
            </span>
            <p className={styles.footerTagline}>{t('landing.footer.tagline')}</p>
          </div>
          <div className={styles.footerCol}>
            <span className={styles.footerColTitle}>{t('landing.footer.product')}</span>
            <a href="#features">{t('landing.footer.links.features')}</a>
            <a href="#pricing">{t('landing.footer.links.pricing')}</a>
          </div>
          <div className={styles.footerCol}>
            <span className={styles.footerColTitle}>{t('landing.footer.company')}</span>
            <Link to="/login">{t('landing.footer.links.login')}</Link>
            <Link to="/register">{t('landing.footer.links.register')}</Link>
          </div>
          <div className={styles.footerCol}>
            <span className={styles.footerColTitle}>{t('landing.footer.legal')}</span>
            <Link to="/cgu">{t('landing.footer.links.cgu')}</Link>
            <Link to="/privacy">{t('landing.footer.links.privacy')}</Link>
            <Link to="/cookies">{t('landing.footer.links.cookies')}</Link>
          </div>
        </div>
        <div className={styles.footerBottom}>
          {t('landing.footer.copyright', { year })}
        </div>
      </footer>
    </div>
  );
}
