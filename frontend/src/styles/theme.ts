export const palette = {
  ink: '#0B1220',
  surface: '#121B2E',
  textPrimary: '#E8ECF3',
  amber: '#F2A93C',
  teal: '#3FA796',
  red: '#E8544C',
} as const;

export const colors = {
  dark: {
    bg: palette.ink,
    surface: palette.surface,
    surfaceAlt: '#182339',
    surfaceHover: '#1E2A45',
    border: 'rgba(242, 169, 60, 0.2)',
    borderSubtle: 'rgba(232, 236, 243, 0.08)',
    text: palette.textPrimary,
    textSecondary: '#9BA6B9',
    textTertiary: '#7A8BA3',
    accent: palette.amber,
    accentHover: '#E89E2E',
    accentMuted: 'rgba(242, 169, 60, 0.15)',
    teal: palette.teal,
    tealMuted: 'rgba(63, 167, 150, 0.15)',
    red: palette.red,
    redMuted: 'rgba(232, 84, 76, 0.15)',
    overlay: 'rgba(11, 18, 32, 0.7)',
    glass: 'rgba(18, 27, 46, 0.88)',
    glassBorder: 'rgba(242, 169, 60, 0.15)',
    inputBg: '#0D1525',
    inputBorder: '#1E2A45',
    inputFocus: palette.amber,
    skeleton: '#182339',
    mapAttribution: 'rgba(232, 236, 243, 0.6)',
    statusMoving: palette.amber,
    statusStatic: palette.teal,
    statusAlert: palette.red,
    shadow: '0 4px 24px rgba(0,0,0,0.4)',
    shadowLg: '0 8px 40px rgba(0,0,0,0.5)',
    shadowDialog: '0 2px 8px rgba(0,0,0,0.3), 0 20px 60px rgba(0,0,0,0.4)',
    chartGrid: 'rgba(232, 236, 243, 0.08)',
    chartTooltip: '#182339',
  },
  light: {
    bg: '#F3F5F9',
    surface: '#FFFFFF',
    surfaceAlt: '#F8F9FB',
    surfaceHover: '#EEF0F4',
    border: 'rgba(11, 18, 32, 0.12)',
    borderSubtle: 'rgba(11, 18, 32, 0.06)',
    text: '#1A2332',
    textSecondary: '#5D6B83',
    textTertiary: '#9BA6B9',
    accent: '#D48B1E',
    accentHover: '#B87614',
    accentMuted: 'rgba(212, 139, 30, 0.1)',
    teal: '#2E8B7A',
    tealMuted: 'rgba(46, 139, 122, 0.1)',
    red: '#CC3D36',
    redMuted: 'rgba(204, 61, 54, 0.1)',
    overlay: 'rgba(11, 18, 32, 0.3)',
    glass: 'rgba(255, 255, 255, 0.85)',
    glassBorder: 'rgba(11, 18, 32, 0.08)',
    inputBg: '#FFFFFF',
    inputBorder: '#D1D6E0',
    inputFocus: '#D48B1E',
    skeleton: '#E5E7EB',
    mapAttribution: 'rgba(26, 35, 50, 0.6)',
    statusMoving: '#D48B1E',
    statusStatic: '#2E8B7A',
    statusAlert: '#CC3D36',
    shadow: '0 4px 24px rgba(0,0,0,0.08)',
    shadowLg: '0 8px 40px rgba(0,0,0,0.12)',
    shadowDialog: '0 2px 8px rgba(0,0,0,0.06), 0 20px 60px rgba(0,0,0,0.1)',
    chartGrid: 'rgba(11, 18, 32, 0.08)',
    chartTooltip: '#FFFFFF',
  },
};

export type ThemeMode = 'dark' | 'light';
export type ThemeColors = typeof colors.dark;

export const typography = {
  display: "'Space Grotesk', sans-serif",
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
  xs: '0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)',
  sm: '0 2px 6px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.2)',
  md: '0 4px 12px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.15)',
  lg: '0 8px 24px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.2)',
  xl: '0 12px 40px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.2)',
  '2xl': '0 20px 60px rgba(0,0,0,0.55), 0 8px 24px rgba(0,0,0,0.25)',
  glow: '0 0 12px rgba(242,169,60,0.35)',
  glowDanger: '0 0 12px rgba(232,84,76,0.35)',
  light: {
    xs: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)',
    sm: '0 2px 6px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
    md: '0 4px 12px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.05)',
    lg: '0 8px 24px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06)',
    xl: '0 12px 40px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.08)',
    '2xl': '0 20px 60px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.1)',
    glow: '0 0 12px rgba(212,139,30,0.2)',
    glowDanger: '0 0 12px rgba(204,61,54,0.2)',
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

export function buildCssVars(mode: ThemeMode): string {
  const c = colors[mode];
  return `
:root[data-theme="${mode}"] {
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
  --color-teal-muted: ${c.tealMuted};
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
  --shadow-xs: ${mode === 'dark' ? shadows.xs : shadows.light.xs};
  --shadow-sm: ${mode === 'dark' ? shadows.sm : shadows.light.sm};
  --shadow-md: ${mode === 'dark' ? shadows.md : shadows.light.md};
  --shadow-lg: ${mode === 'dark' ? shadows.lg : shadows.light.lg};
  --shadow-xl: ${mode === 'dark' ? shadows.xl : shadows.light.xl};
  --shadow-2xl: ${mode === 'dark' ? shadows['2xl'] : shadows.light['2xl']};
  --shadow-glow: ${mode === 'dark' ? shadows.glow : shadows.light.glow};
  --shadow-glow-danger: ${mode === 'dark' ? shadows.glowDanger : shadows.light.glowDanger};
  --ease-premium: ${easing.premium};
  --ease-snappy: ${easing.snappy};
  --ease-smooth: ${easing.smooth};
  --duration-fast: ${duration.fast};
  --duration-base: ${duration.base};
  --duration-slow: ${duration.slow};
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
  font-weight: var(--weight-bold);
  line-height: var(--lh-tight);
  margin: 0;
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
`;

// Backward-compatible aliases for auth pages still using old `tokens` export
export const tokens = {
  color: {
    primary: '#D48B1E',
    primaryHover: '#B87614',
    primaryLight: '#FEF5E7',
    primarySubtle: 'rgba(212, 139, 30, 0.08)',
    primaryShadow: 'rgba(212, 139, 30, 0.25)',
    error: '#CC3D36',
    errorBg: 'rgba(204, 61, 54, 0.08)',
    errorBorder: 'rgba(204, 61, 54, 0.2)',
    success: '#2E8B7A',
    text: '#E8ECF3',
    textSecondary: '#9BA6B9',
    textTertiary: '#5D6B83',
    textInverse: '#0B1220',
    bg: '#0B1220',
    bgWash: '#121B2E',
    glassBg: 'rgba(18, 27, 46, 0.88)',
    glassBorder: 'rgba(242, 169, 60, 0.15)',
    glassShadow: '0 8px 32px rgba(0,0,0,0.4)',
    inputBorder: '#1E2A45',
    inputFocusRing: 'rgba(242, 169, 60, 0.12)',
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
    btnHover: '0 4px 14px rgba(26,86,219,0.35)',
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
