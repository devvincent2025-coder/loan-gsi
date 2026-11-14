import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1400px' } },
    extend: {
      fontFamily: {
        sans: [
          'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto',
          '"Helvetica Neue"', 'Arial', '"Noto Sans"', 'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', '"Liberation Mono"', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        success: { DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-foreground))' },
        warning: { DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-foreground))' },
        info: { DEFAULT: 'hsl(var(--info))', foreground: 'hsl(var(--info-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          border: 'hsl(var(--sidebar-border))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          muted: 'hsl(var(--sidebar-muted-foreground))',
        },
        chart: {
          1: 'hsl(var(--chart-1))', 2: 'hsl(var(--chart-2))', 3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))', 5: 'hsl(var(--chart-5))', 6: 'hsl(var(--chart-6))',
        },
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      boxShadow: {
        card: '0 0 0 1px hsl(var(--shadow) / 0.04), 0 0 24px hsl(var(--shadow) / 0.08), 0 0 8px hsl(var(--shadow) / 0.05)',
        'card-hover': '0 0 0 1px hsl(var(--shadow) / 0.06), 0 0 40px hsl(var(--shadow) / 0.12), 0 0 12px hsl(var(--shadow) / 0.07)',
        pop: '0 10px 30px -8px hsl(var(--shadow) / 0.25), 0 2px 6px hsl(var(--shadow) / 0.08)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'number-reveal': { from: { opacity: '0', filter: 'blur(6px)', transform: 'translateY(4px)' }, to: { opacity: '1', filter: 'blur(0)', transform: 'translateY(0)' } },
        'sheet-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'sheet-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
      },
      animation: {
        'fade-in': 'fade-in .2s ease-out both',
        'slide-up': 'slide-up .3s cubic-bezier(0.16,1,0.3,1) both',
        'number-reveal': 'number-reveal .4s cubic-bezier(0.16,1,0.3,1) both',
        'sheet-left': 'sheet-left .2s ease-out',
        'sheet-right': 'sheet-right .2s ease-out',
      },
    },
  },
  plugins: [],
};
export default config;
