import { useEffect } from 'react';
import styles from './CookiesPage.module.css';

export default function CookiesPage() {
  useEffect(() => { document.title = 'Politique de cookies — DeliveryTrack'; }, []);

  return (
    <>
      <div className={styles.container}>
        <h1 className={styles.h1}>Politique de cookies</h1>
        <p className={styles.updated}>Derni&egrave;re mise &agrave; jour : juillet 2026</p>

        <h2 className={styles.h2}>1. Qu&rsquo;est-ce qu&rsquo;un cookie ?</h2>
        <p className={styles.p}>
          Un cookie est un petit fichier texte d&eacute;pos&eacute; sur votre appareil lors de la visite d&rsquo;un site web.
          Il permet de stocker des informations temporaires n&eacute;cessaires au fonctionnement du service ou
          &agrave; l&rsquo;analyse d&rsquo;audience. Nous utilisons des cookies conform&eacute;ment au R&egrave;glement ePrivacy (UE) et
          aux recommandations de la CNIL.
        </p>

        <h2 className={styles.h2}>2. Cookies utilis&eacute;s</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Cookie</th>
              <th className={styles.th}>Type</th>
              <th className={styles.th}>Finalit&eacute;</th>
              <th className={styles.th}>Dur&eacute;e</th>
              <th className={styles.th}>Consentement requis</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={styles.td}><code>refresh_token</code></td>
              <td className={styles.td}>Essentiel (httpOnly)</td>
              <td className={styles.td}>Maintien de la session utilisateur</td>
              <td className={styles.td}>7 jours</td>
              <td className={styles.td}>Non (n&eacute;cessaire au service)</td>
            </tr>
            <tr>
              <td className={styles.td}><code>csrf_token</code></td>
              <td className={styles.td}>Essentiel</td>
              <td className={styles.td}>Protection contre les attaques CSRF</td>
              <td className={styles.td}>Session</td>
              <td className={styles.td}>Non (n&eacute;cessaire &agrave; la s&eacute;curit&eacute;)</td>
            </tr>
            <tr>
              <td className={styles.td}><code>cookie_consent</code></td>
              <td className={styles.td}>Fonctionnel</td>
              <td className={styles.td}>M&eacute;moriser votre choix de consentement</td>
              <td className={styles.td}>6 mois</td>
              <td className={styles.td}>Non (stocke votre choix)</td>
            </tr>
            <tr>
              <td className={styles.td}>Sentry (localStorage)</td>
              <td className={styles.td}>Analytique</td>
              <td className={styles.td}>Journaux d&rsquo;erreurs et performance</td>
              <td className={styles.td}>Persistant</td>
              <td className={styles.td}>Oui</td>
            </tr>
          </tbody>
        </table>

        <h2 className={styles.h2}>3. Gestion des cookies</h2>
        <p className={styles.p}>
          Lors de votre premi&egrave;re visite, une banni&egrave;re vous permet d&rsquo;accepter ou de refuser les cookies
          non-essentiels. Vous pouvez &agrave; tout moment modifier vos pr&eacute;f&eacute;rences en cliquant sur le lien
          &laquo;&nbsp;G&eacute;rer les cookies&nbsp;&raquo; en bas de page.
        </p>
        <p className={styles.p}>
          Vous pouvez &eacute;galement configurer votre navigateur pour refuser tous les cookies ou pour &ecirc;tre
          alert&eacute; lorsqu&rsquo;un cookie est d&eacute;pos&eacute;. Notez que le refus des cookies essentiels emp&ecirc;chera
          le fonctionnement normal du service.
        </p>

        <h2 className={styles.h2}>4. Base l&eacute;gale</h2>
        <p className={styles.p}>
          Les cookies essentiels sont d&eacute;pos&eacute;s sur la base de l&rsquo;int&eacute;r&ecirc;t l&eacute;gitime (Art. 6.1.f RGPD)
          car ils sont strictement n&eacute;cessaires au fonctionnement du service. Les cookies non-essentiels
          sont d&eacute;pos&eacute;s uniquement apr&egrave;s recueil de votre consentement explicite (Art. 6.1.a RGPD,
          Art. 82 de la loi Informatique et Libert&eacute;s, D&eacute;lib&eacute;ration CNIL n&deg;2020-092).
        </p>

        <h2 className={styles.h2}>5. Contact</h2>
        <p className={styles.p}>
          Pour toute question relative aux cookies : <strong>privacy@deliverytrack.app</strong>
        </p>
      </div>
    </>
  );
}
