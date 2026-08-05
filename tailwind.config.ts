import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Retro-futurist "instrument panel" palette — see docs/DESIGN_SYSTEM.md.
        // Ported 1:1 from the Claude Design mockup's `const C = {...}` palette
        // so every screen shares one source of truth for tone.
        background: '#0c0c0e',
        surface: '#18181b',
        'surface-2': '#1c1c20',
        border: '#27272a',
        accent: '#a78bfa',        // mockup: vio / VL
        'accent-dim': '#7c3aed',  // mockup: V
        'accent-bright': '#c4b5fd',
        'text-primary': '#f4f4f5',   // mockup: bright — headings / high emphasis
        'text-secondary': '#d4d4d8', // mockup: txt — default body/data text
        'text-muted': '#a1a1aa',     // mockup: dim — secondary labels
        'text-faint': '#71717a',     // mockup: mut — de-emphasized labels
        'text-ghost': '#52525b',     // mockup: faint — placeholders, inactive
        success: '#4ade80',
        warning: '#facc15',
        danger: '#f87171',
        orange: '#fb923c',
        amber: '#ffb340', // VFD/VU-meter accent — distinct from `warning`
      },
      fontFamily: {
        sans: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        xs: ['11px', { lineHeight: '1.5' }],
        sm: ['13px', { lineHeight: '1.5' }],
        base: ['15px', { lineHeight: '1.6' }],
        lg: ['18px', { lineHeight: '1.5' }],
        xl: ['22px', { lineHeight: '1.4' }],
        '3xl': ['30px', { lineHeight: '1.2' }],
        '5xl': ['48px', { lineHeight: '1.1' }],
      },
      letterSpacing: {
        widest2: '.2em',
      },
    },
  },
  plugins: [],
}

export default config
