import { useEffect } from 'react';

const s: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 800, margin: '0 auto', padding: 'var(--space-4xl) var(--space-lg)',
    fontFamily: 'var(--font-body)', color: 'var(--color-text)', lineHeight: 1.7,
  },
  h1: { fontSize: 'var(--text-3xl)', fontWeight: 700, marginBottom: 'var(--space-md)' },
  h2: { fontSize: 'var(--text-xl)', fontWeight: 600, marginTop: 'var(--space-2xl)', marginBottom: 'var(--space-sm)' },
  p: { marginBottom: 'var(--space-md)' },
  ul: { marginBottom: 'var(--space-md)', paddingLeft: 'var(--space-xl)' },
  li: { marginBottom: 'var(--space-xs)' },
  updated: { color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-xl)' },
  table: { width: '100%', borderCollapse: 'collapse', marginBottom: 'var(--space-md)' },
  th: { border: '1px solid var(--color-border)', padding: 'var(--space-sm) var(--space-md)', background: 'var(--color-surface-alt)', textAlign: 'left' as const, fontWeight: 600 },
  td: { border: '1px solid var(--color-border)', padding: 'var(--space-sm) var(--space-md)' },
};

export default function CookiesPage() {
  useEffect(() => { document.title = 'Politique de cookies — DeliveryTrack'; }, []);

  return (
    <>
      <div style={s.container}>
        <h1 style={s.h1}>Politique de cookies</h1>
        <p style={s.updated}>Derni&egrave;re mise &agrave; jour : juillet 2026</p>

        <h2 style={s.h2}>1. Qu&rsquo;est-ce qu&rsquo;un cookie ?</h2>
        <p style={s.p}>
          Un cookie est un petit fichier texte d&eacute;pos&eacute; sur votre appareil lors de la visite d&rsquo;un site web.
          Il permet de stocker des informations temporaires n&eacute;cessaires au fonctionnement du service ou
          &agrave; l&rsquo;analyse d&rsquo;audience. Nous utilisons des cookies conform&eacute;ment au R&egrave;glement ePrivacy (UE) et
          aux recommandations de la CNIL.
        </p>

        <h2 style={s.h2}>2. Cookies utilis&eacute;s</h2>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Cookie</th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Finalit&eacute;</th>
              <th style={s.th}>Dur&eacute;e</th>
              <th style={s.th}>Consentement requis</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={s.td}><code>refresh_token</code></td>
              <td style={s.td}>Essentiel (httpOnly)</td>
              <td style={s.td}>Maintien de la session utilisateur</td>
              <td style={s.td}>7 jours</td>
              <td style={s.td}>Non (n&eacute;cessaire au service)</td>
            </tr>
            <tr>
              <td style={s.td}><code>csrf_token</code></td>
              <td style={s.td}>Essentiel</td>
              <td style={s.td}>Protection contre les attaques CSRF</td>
              <td style={s.td}>Session</td>
              <td style={s.td}>Non (n&eacute;cessaire &agrave; la s&eacute;curit&eacute;)</td>
            </tr>
            <tr>
              <td style={s.td}><code>cookie_consent</code></td>
              <td style={s.td}>Fonctionnel</td>
              <td style={s.td}>M&eacute;moriser votre choix de consentement</td>
              <td style={s.td}>6 mois</td>
              <td style={s.td}>Non (stocke votre choix)</td>
            </tr>
            <tr>
              <td style={s.td}>Sentry (localStorage)</td>
              <td style={s.td}>Analytique</td>
              <td style={s.td}>Journaux d&rsquo;erreurs et performance</td>
              <td style={s.td}>Persistant</td>
              <td style={s.td}>Oui</td>
            </tr>
          </tbody>
        </table>

        <h2 style={s.h2}>3. Gestion des cookies</h2>
        <p style={s.p}>
          Lors de votre premi&egrave;re visite, une banni&egrave;re vous permet d&rsquo;accepter ou de refuser les cookies
          non-essentiels. Vous pouvez &agrave; tout moment modifier vos pr&eacute;f&eacute;rences en cliquant sur le lien
          &laquo;&nbsp;G&eacute;rer les cookies&nbsp;&raquo; en bas de page.
        </p>
        <p style={s.p}>
          Vous pouvez &eacute;galement configurer votre navigateur pour refuser tous les cookies ou pour &ecirc;tre
          alert&eacute; lorsqu&rsquo;un cookie est d&eacute;pos&eacute;. Notez que le refus des cookies essentiels emp&ecirc;chera
          le fonctionnement normal du service.
        </p>

        <h2 style={s.h2}>4. Base l&eacute;gale</h2>
        <p style={s.p}>
          Les cookies essentiels sont d&eacute;pos&eacute;s sur la base de l&rsquo;int&eacute;r&ecirc;t l&eacute;gitime (Art. 6.1.f RGPD)
          car ils sont strictement n&eacute;cessaires au fonctionnement du service. Les cookies non-essentiels
          sont d&eacute;pos&eacute;s uniquement apr&egrave;s recueil de votre consentement explicite (Art. 6.1.a RGPD,
          Art. 82 de la loi Informatique et Libert&eacute;s, D&eacute;lib&eacute;ration CNIL n&deg;2020-092).
        </p>

        <h2 style={s.h2}>5. Contact</h2>
        <p style={s.p}>
          Pour toute question relative aux cookies : <strong>privacy@deliverytrack.app</strong>
        </p>
      </div>
    </>
  );
}
