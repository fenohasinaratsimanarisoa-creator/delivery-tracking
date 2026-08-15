export const palette = {
  ink: '#101216',
  surface: '#171A1F',
  textPrimary: '#EDEEF0',
  accent: '#6FBF9E',
  teal: '#4CAF87',
  red: '#E0756C',
} as const;

export const colors = {
  dark: {
    bg: palette.ink,
    surface: palette.surface,
    surfaceAlt: '#1C2026',
    surfaceHover: '#232830',
    border: 'rgba(237, 238, 240, 0.10)',
    borderSubtle: 'rgba(237, 238, 240, 0.05)',
    text: palette.textPrimary,
    textSecondary: '#A0A6B0',
    textTertiary: '#7A8089',
    accent: palette.accent,
    accentHover: '#7ECBA9',
    accentMuted: 'rgba(111, 191, 158, 0.14)',
    teal: palette.teal,
    tealHover: '#3E9A7B',
    tealMuted: 'rgba(76, 175, 135, 0.14)',
    // Cyan distinct du teal (pour distinguer des statuts voisins dans une même liste,
    // ex. carburant Électrique vs Hybride, statut assigned vs delivered). Désaturé,
    // reste discret — jamais décoratif. Contraste AA sur fond surface dark.
    cyan: '#63A5BF',
    cyanMuted: 'rgba(99, 165, 191, 0.14)',
    red: palette.red,
    redMuted: 'rgba(224, 117, 108, 0.14)',
    overlay: 'rgba(10, 12, 16, 0.7)',
    // Glass = surface OPAQUE (anti-glassmorphism) : panneaux solides type Linear/Stripe,
    // la transparence + blur étaient hérités de l'ancienne DA « hero SaaS ».
    glass: '#171A1F',
    glassBorder: 'rgba(237, 238, 240, 0.08)',
    inputBg: '#12151A',
    inputBorder: '#262B33',
    inputFocus: palette.accent,
    skeleton: '#1E2229',
    mapAttribution: 'rgba(237, 238, 240, 0.6)',
    statusMoving: palette.accent,
    statusStatic: palette.teal,
    statusAlert: palette.red,
    // Bleu ardoise désaturé — réservé au statut fonctionnel in_progress. PAS le
    // bleu startup (#3B82F6) : les statuts restent discrets, jamais décoratifs.
    blue: '#8AA8C7',
    blueMuted: 'rgba(138, 168, 199, 0.14)',
    purple: '#A795C4',
    purpleMuted: 'rgba(167, 149, 196, 0.14)',
    orange: '#D9A441',
    orangeMuted: 'rgba(217, 164, 65, 0.14)',
    warning: '#D9A441',
    warningMuted: 'rgba(217, 164, 65, 0.12)',
    warningSubtle: 'rgba(217, 164, 65, 0.08)',
    shadow: '0 4px 16px rgba(0,0,0,0.35)',
    shadowLg: '0 8px 32px rgba(0,0,0,0.45)',
    shadowDialog: '0 2px 8px rgba(0,0,0,0.3), 0 20px 60px rgba(0,0,0,0.4)',
    chartGrid: 'rgba(237, 238, 240, 0.07)',
    chartTooltip: '#1C2026',
  },
  light: {
    bg: '#F6F7F9',
    surface: '#FFFFFF',
    surfaceAlt: '#F8F9FB',
    surfaceHover: '#EFF1F4',
    border: 'rgba(22, 24, 29, 0.10)',
    borderSubtle: 'rgba(22, 24, 29, 0.05)',
    text: '#16181D',
    textSecondary: '#4B5563',
    // Tertiaire assez foncé pour rester AA (≥4.5 sur fond blanc : #6B7280 = 4.9)
    // — l'ancien #8A929E tombait à ~3.1 (date du dashboard illisible sur la carte).
    textTertiary: '#6B7280',
    accent: '#2F6B4F',
    accentHover: '#275A43',
    accentMuted: 'rgba(47, 107, 79, 0.10)',
    teal: '#2E7D5B',
    tealHover: '#256B52',
    tealMuted: 'rgba(46, 125, 91, 0.10)',
    // Cyan light : distinct du teal light (#2E7D5B). Désaturé, discret.
    cyan: '#16708A',
    cyanMuted: 'rgba(22, 112, 138, 0.10)',
    red: '#B4443B',
    redMuted: 'rgba(180, 68, 59, 0.10)',
    overlay: 'rgba(16, 18, 22, 0.3)',
    glass: '#FFFFFF',
    glassBorder: 'rgba(22, 24, 29, 0.08)',
    inputBg: '#FFFFFF',
    inputBorder: '#D4D8DE',
    inputFocus: '#2F6B4F',
    skeleton: '#E7E9ED',
    mapAttribution: 'rgba(22, 24, 29, 0.55)',
    statusMoving: '#2F6B4F',
    statusStatic: '#2E7D5B',
    statusAlert: '#B4443B',
    blue: '#4A6B8A',
    blueMuted: 'rgba(74, 107, 138, 0.10)',
    purple: '#6B5A8C',
    purpleMuted: 'rgba(107, 90, 140, 0.10)',
    orange: '#B7791F',
    orangeMuted: 'rgba(183, 121, 31, 0.10)',
    warning: '#B7791F',
    warningMuted: 'rgba(183, 121, 31, 0.08)',
    warningSubtle: 'rgba(183, 121, 31, 0.05)',
    shadow: '0 1px 3px rgba(16,18,22,0.06)',
    shadowLg: '0 4px 16px rgba(16,18,22,0.08)',
    shadowDialog: '0 2px 8px rgba(16,18,22,0.05), 0 16px 40px rgba(16,18,22,0.08)',
    chartGrid: 'rgba(22, 24, 29, 0.07)',
    chartTooltip: '#FFFFFF',
  },
  // Variante « field » : usage terrain mobile en extérieur (drivers / clients).
  // Palette sobre, accent désaturé, fort contraste lisible en plein soleil,
  // ombres légères, aucun glow/halo. Appliquée via [data-context="field"]
  // sur <html>, indépendamment du choix dark/light de l'admin. Les tokens de
  // structure (space/radius/typography) restent identiques au control room.
  field: {
    bg: '#F4F5F6',
    surface: '#FFFFFF',
    surfaceAlt: '#F6F8FA',
    surfaceHover: '#E9ECEF',
    border: 'rgba(20, 23, 27, 0.14)',
    borderSubtle: 'rgba(20, 23, 27, 0.07)',
    text: '#14171B',
    textSecondary: '#33373D',
    textTertiary: '#5B6470',
    accent: '#275A43',
    accentHover: '#1F4A37',
    accentMuted: 'rgba(39, 90, 67, 0.12)',
    teal: '#256B52',
    tealHover: '#1F5A44',
    tealMuted: 'rgba(37, 107, 82, 0.10)',
    // Cyan field : distinct du teal field (#256B52) et de l'accent field (#275A43).
    // Contraste AA sur fond blanc.
    cyan: '#14607A',
    cyanMuted: 'rgba(20, 96, 122, 0.10)',
    red: '#B03A32',
    redMuted: 'rgba(176, 58, 50, 0.10)',
    overlay: 'rgba(15, 23, 42, 0.4)',
    glass: '#FFFFFF',
    glassBorder: 'rgba(15, 23, 42, 0.08)',
    inputBg: '#FFFFFF',
    inputBorder: '#C7CDD4',
    inputFocus: '#275A43',
    skeleton: '#E2E6EA',
    mapAttribution: 'rgba(20, 23, 27, 0.65)',
    statusMoving: '#275A43',
    statusStatic: '#256B52',
    statusAlert: '#B03A32',
    blue: '#3A5F7D',
    blueMuted: 'rgba(58, 95, 125, 0.10)',
    purple: '#5E4F7E',
    purpleMuted: 'rgba(94, 79, 126, 0.10)',
    orange: '#9A6314',
    orangeMuted: 'rgba(154, 99, 20, 0.10)',
    warning: '#9A6314',
    warningMuted: 'rgba(154, 99, 20, 0.08)',
    warningSubtle: 'rgba(154, 99, 20, 0.05)',
    shadow: '0 1px 2px rgba(15,23,42,0.05)',
    shadowLg: '0 4px 14px rgba(15,23,42,0.08)',
    shadowDialog: '0 2px 8px rgba(15,23,42,0.06), 0 16px 40px rgba(15,23,42,0.14)',
    chartGrid: 'rgba(15, 23, 42, 0.08)',
    chartTooltip: '#FFFFFF',
  },
};

export type ThemeMode = 'dark' | 'light';
export type ThemeColors = { [K in keyof typeof colors.dark]: string };

export const typography = {
  display: "'IBM Plex Sans', 'Inter', sans-serif",
  body: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
  scale: {
    xs: '0.625rem',
    sm: '0.75rem',
    base: '0.875rem',
    md: '1rem',
    lg: '1.125rem',
    xl: '1.5rem',
    '2xl': '2rem',
    '3xl': '2.5rem',
  },
  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lh: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 48,
  px: 1,
} as const;

export const radius = {
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  '2xl': 16,
  full: 9999,
} as const;

export const shadows = {
  xs: '0 1px 2px rgba(0,0,0,0.3), 0 1px 1px rgba(0,0,0,0.15)',
  sm: '0 1px 3px rgba(0,0,0,0.32), 0 1px 2px rgba(0,0,0,0.18)',
  md: '0 2px 8px rgba(0,0,0,0.36), 0 1px 3px rgba(0,0,0,0.14)',
  lg: '0 4px 16px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.18)',
  xl: '0 8px 32px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.18)',
  '2xl': '0 16px 48px rgba(0,0,0,0.5), 0 8px 20px rgba(0,0,0,0.22)',
  glow: '0 0 0 2px rgba(111,191,158,0.25)',
  glowDanger: '0 0 0 2px rgba(224,117,108,0.25)',
  light: {
    xs: '0 1px 2px rgba(16,18,22,0.04), 0 1px 1px rgba(16,18,22,0.02)',
    sm: '0 1px 3px rgba(16,18,22,0.05), 0 1px 2px rgba(16,18,22,0.03)',
    md: '0 2px 8px rgba(16,18,22,0.06), 0 1px 3px rgba(16,18,22,0.04)',
    lg: '0 4px 16px rgba(16,18,22,0.08), 0 2px 6px rgba(16,18,22,0.05)',
    xl: '0 8px 32px rgba(16,18,22,0.10), 0 4px 12px rgba(16,18,22,0.06)',
    '2xl': '0 16px 48px rgba(16,18,22,0.12), 0 8px 20px rgba(16,18,22,0.08)',
    glow: '0 0 0 2px rgba(47,107,79,0.18)',
    glowDanger: '0 0 0 2px rgba(180,68,59,0.18)',
  },
} as const;

export const easing = {
  premium: 'cubic-bezier(0.16, 1, 0.3, 1)',
  snappy: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
  linear: 'linear',
} as const;

export const duration = {
  fast: '120ms',
  base: '200ms',
  slow: '350ms',
} as const;

function cssVarBody(
  c: ThemeColors,
  shadowMap: { [K in keyof (typeof shadows)['light']]: string },
  glow: string,
  glowDanger: string,
): string {
  return `
  --color-bg: ${c.bg};
  --color-surface: ${c.surface};
  --color-surface-alt: ${c.surfaceAlt};
  --color-surface-hover: ${c.surfaceHover};
  --color-border: ${c.border};
  --color-border-subtle: ${c.borderSubtle};
  --color-text: ${c.text};
  --color-text-secondary: ${c.textSecondary};
  --color-text-tertiary: ${c.textTertiary};
  --color-accent: ${c.accent};
  --color-accent-hover: ${c.accentHover};
  --color-accent-muted: ${c.accentMuted};
  --color-teal: ${c.teal};
  --color-teal-hover: ${c.tealHover};
  --color-teal-muted: ${c.tealMuted};
  --color-cyan: ${c.cyan};
  --color-cyan-muted: ${c.cyanMuted};
  --color-red: ${c.red};
  --color-red-muted: ${c.redMuted};
  --color-overlay: ${c.overlay};
  --color-glass: ${c.glass};
  --color-glass-border: ${c.glassBorder};
  --color-input-bg: ${c.inputBg};
  --color-input-border: ${c.inputBorder};
  --color-input-focus: ${c.inputFocus};
  --color-skeleton: ${c.skeleton};
  --color-map-attribution: ${c.mapAttribution};
  --color-status-moving: ${c.statusMoving};
  --color-status-static: ${c.statusStatic};
  --color-status-alert: ${c.statusAlert};
  --color-blue: ${c.blue};
  --color-blue-muted: ${c.blueMuted};
  --color-purple: ${c.purple};
  --color-purple-muted: ${c.purpleMuted};
  --color-orange: ${c.orange};
  --color-orange-muted: ${c.orangeMuted};
  --color-warning: ${c.warning};
  --color-warning-muted: ${c.warningMuted};
  --color-warning-subtle: ${c.warningSubtle};
  --shadow-sm: ${c.shadow};
  --shadow-lg: ${c.shadowLg};
  --shadow-dialog: ${c.shadowDialog};
  --color-chart-grid: ${c.chartGrid};
  --color-chart-tooltip: ${c.chartTooltip};
  --font-display: ${typography.display};
  --font-body: ${typography.body};
  --font-mono: ${typography.mono};
  --text-xs: ${typography.scale.xs};
  --text-sm: ${typography.scale.sm};
  --text-base: ${typography.scale.base};
  --text-md: ${typography.scale.md};
  --text-lg: ${typography.scale.lg};
  --text-xl: ${typography.scale.xl};
  --text-2xl: ${typography.scale['2xl']};
  --text-3xl: ${typography.scale['3xl']};
  --weight-normal: ${typography.weight.normal};
  --weight-medium: ${typography.weight.medium};
  --weight-semibold: ${typography.weight.semibold};
  --weight-bold: ${typography.weight.bold};
  --lh-tight: ${typography.lh.tight};
  --lh-normal: ${typography.lh.normal};
  --lh-relaxed: ${typography.lh.relaxed};
  --space-xs: ${space.xs}px;
  --space-sm: ${space.sm}px;
  --space-md: ${space.md}px;
  --space-lg: ${space.lg}px;
  --space-xl: ${space.xl}px;
  --space-2xl: ${space['2xl']}px;
  --space-3xl: ${space['3xl']}px;
  --space-4xl: ${space['4xl']}px;
  --radius-xs: ${radius.xs}px;
  --radius-sm: ${radius.sm}px;
  --radius-md: ${radius.md}px;
  --radius-lg: ${radius.lg}px;
  --radius-xl: ${radius.xl}px;
  --radius-2xl: ${radius['2xl']}px;
  --radius-full: ${radius.full}px;
  --shadow-xs: ${shadowMap.xs};
  --shadow-sm: ${shadowMap.sm};
  --shadow-md: ${shadowMap.md};
  --shadow-lg: ${shadowMap.lg};
  --shadow-xl: ${shadowMap.xl};
  --shadow-2xl: ${shadowMap['2xl']};
  --shadow-glow: ${glow};
  --shadow-glow-danger: ${glowDanger};
  --ease-premium: ${easing.premium};
  --ease-snappy: ${easing.snappy};
  --ease-smooth: ${easing.smooth};
  --duration-fast: ${duration.fast};
  --duration-base: ${duration.base};
  --duration-slow: ${duration.slow};
`;
}

export function buildCssVars(mode: ThemeMode): string {
  const c = colors[mode];
  const isDark = mode === 'dark';
  const shadowMap = isDark ? shadows : shadows.light;
  return `:root[data-theme="${mode}"] {\n${cssVarBody(c, shadowMap, shadowMap.glow, shadowMap.glowDanger)}\n}`;
}

// Bloc « field » : mêmes variables, mais scopées sur le layout driver/field.
// Sélecteur `html[data-context="field"][data-context="field"]` → spécificité
// (0,2,1), strictement supérieure à `:root[data-theme]` (0,2,0) — le thème
// field l'emporte sur dark/light. Glow désactivé (none) + animations
// neutralisées + transitions réduites.
export function buildFieldVars(): string {
  const s = 'html[data-context="field"][data-context="field"]';
  return `
${s} {
${cssVarBody(colors.field, shadows.light, 'none', 'none')}
  --duration-fast: 80ms;
  --duration-base: 130ms;
  --duration-slow: 200ms;
}
${s} *,
${s} *::before,
${s} *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
}
${s} button,
${s} a,
${s} .clickable {
  box-shadow: none !important;
}
`;
}

export const globalStyles = `
*, *::before, *::after {
  box-sizing: border-box;
}

html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  padding: 0;
  font-family: var(--font-body);
  font-size: var(--text-base);
  line-height: var(--lh-normal);
  color: var(--color-text);
  background: var(--color-bg);
  transition: background-color 0.2s ease, color 0.2s ease;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-display);
  font-weight: var(--weight-semibold);
  line-height: var(--lh-tight);
  margin: 0;
  letter-spacing: -0.01em;
}

a {
  color: var(--color-accent);
  text-decoration: none;
}

a:hover {
  color: var(--color-accent-hover);
}

code, pre, .technical-data {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  letter-spacing: -0.01em;
}

input, textarea, select, button {
  font-family: var(--font-body);
}

button, a, .clickable {
  transition: background var(--transition-fast) ease, color var(--transition-fast) ease, opacity var(--transition-fast) ease, border-color var(--transition-fast) ease, box-shadow var(--transition-fast) ease;
}

:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

:focus:not(:focus-visible) {
  outline: none;
}

::selection {
  background: var(--color-accent-muted);
  color: var(--color-text);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
}

@keyframes dt-pulse-moving {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.3); }
}

@keyframes dt-fade-in-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes dt-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@keyframes dt-slide-in-right {
  from { opacity: 0; transform: translateX(100%); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes dt-progress {
  0% { transform: scaleX(0); transform-origin: left; }
  100% { transform: scaleX(1); transform-origin: left; }
}

.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 2px;
}

.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-tertiary);
}

/* ─── Mobile: scale up typography & spacing for a readable phone UI ───
   These are variable-only changes → every card, table, chip and button that
   reads a token grows consistently, without touching any layout. Desktop
   (≥701px) is completely unaffected. */
@media (max-width: 700px) {
  :root:root[data-theme] {
    --text-xs: 0.6875rem;
    --text-sm: 0.8125rem;
    --text-base: 0.9375rem;
    --text-md: 1.0313rem;
    --text-lg: 1.1875rem;
    --text-xl: 1.3125rem;
    --text-2xl: 1.625rem;
    --space-md: 14px;
    --space-lg: 18px;
    --space-xl: 26px;
  }

  input, select, textarea {
    font-size: 16px !important;
  }

  body {
    -webkit-tap-highlight-color: transparent;
    caret-color: var(--color-accent);
  }
}

@media (max-width: 360px) {
  :root:root[data-theme] {
    --space-lg: 16px;
    --text-base: 0.9rem;
  }
}
`;

// Backward-compatible aliases for auth pages still using old `tokens` export
export const tokens = {
  color: {
    primary: '#2F6B4F',
    primaryHover: '#275A43',
    primaryLight: '#EDF4F0',
    primarySubtle: 'rgba(47, 107, 79, 0.08)',
    primaryShadow: 'rgba(47, 107, 79, 0.2)',
    error: '#B4443B',
    errorBg: 'rgba(180, 68, 59, 0.08)',
    errorBorder: 'rgba(180, 68, 59, 0.2)',
    success: '#2E7D5B',
    text: '#EDEEF0',
    textSecondary: '#A0A6B0',
    textTertiary: '#7A8089',
    textInverse: '#101216',
    bg: '#101216',
    bgWash: '#171A1F',
    glassBg: 'rgba(23, 26, 31, 0.88)',
    glassBorder: 'rgba(237, 238, 240, 0.08)',
    glassShadow: '0 8px 32px rgba(0,0,0,0.4)',
    inputBorder: '#262B33',
    inputFocusRing: 'rgba(111, 191, 158, 0.12)',
  },
  radius: {
    sm: 4,
    md: 8,
    lg: 12,
  },
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.04)',
    md: '0 4px 16px rgba(0,0,0,0.06)',
    btn: '0 1px 3px rgba(0,0,0,0.12)',
    btnHover: '0 4px 14px rgba(47,107,79,0.3)',
  },
  animation: {
    fast: '150ms',
    normal: '250ms',
    slow: '400ms',
  },
  z: {
    card: 1,
    overlay: 2,
    content: 3,
  },
} as const;

export const keyframes = `
@keyframes dt-fade-in-up {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes dt-spin {
  to { transform: rotate(360deg); }
}
@keyframes dt-dot-drift {
  0%   { transform: translate(0, 0); }
  25%  { transform: translate(4px, -3px); }
  50%  { transform: translate(-2px, 5px); }
  75%  { transform: translate(3px, -2px); }
  100% { transform: translate(0, 0); }
}
@keyframes dt-pulse-glow {
  0%, 100% { opacity: 0.4; }
  50%      { opacity: 0.8; }
}
@keyframes dt-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .dt-animate { animation: none !important; }
  .dt-animate-slide { animation: none !important; }
}
`;
