/** @type {import('tailwindcss').Config} */
const token = (name) => `color-mix(in oklab, var(--${name}) calc(100% * <alpha-value>), transparent)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Geist', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: Object.fromEntries(['background','foreground','card','card-foreground','popover','popover-foreground','primary','primary-foreground','secondary','secondary-foreground','muted','muted-foreground','accent','accent-foreground','destructive','border','input','ring','brand','brand-foreground','brand-from','brand-via','brand-to'].map((name) => [name, token(name)])),
      keyframes: {
        'marquee': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(calc(-100% - var(--gap, 1rem)))' } },
        'marquee-vertical': { from: { transform: 'translateY(0)' }, to: { transform: 'translateY(calc(-100% - var(--gap, 1rem)))' } },
        'shimmer': { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
        'gradient': { to: { backgroundPosition: '200% center' } },
        'orbit': { '0%': { transform: 'rotate(0deg) translateX(var(--radius)) rotate(0deg)' }, '100%': { transform: 'rotate(360deg) translateX(var(--radius)) rotate(-360deg)' } },
        'aurora-1': { '0%': { transform: 'translate(0, 0) rotate(0deg)' }, '100%': { transform: 'translate(10%, 10%) rotate(12deg)' } },
        'aurora-2': { '0%': { transform: 'translate(0, 0) rotate(0deg)' }, '100%': { transform: 'translate(-10%, 8%) rotate(-10deg)' } },
        'aurora-3': { '0%': { transform: 'translate(0, 0) rotate(0deg)' }, '100%': { transform: 'translate(8%, -8%) rotate(8deg)' } },
        'meteor': { '0%': { transform: 'rotate(215deg) translateX(0)', opacity: '1' }, '70%': { opacity: '1' }, '100%': { transform: 'rotate(215deg) translateX(-500px)', opacity: '0' } },
        'retro-grid': { '0%': { transform: 'rotateX(65deg) translateY(0)' }, '100%': { transform: 'rotateX(65deg) translateY(50px)' } },
        'rainbow': { '0%': { backgroundPosition: '0%' }, '100%': { backgroundPosition: '200%' } },
        'ripple': { to: { transform: 'scale(4)', opacity: '0' } },
        'moving-border': { '0%': { backgroundPosition: '0% 50%' }, '100%': { backgroundPosition: '200% 50%' } },
        'flicker': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '.6' } },
        'ripple-ring': { '0%': { transform: 'scale(.8)', opacity: '.5' }, '100%': { transform: 'scale(2.4)', opacity: '0' } },
      },
      animation: {
        'marquee': 'marquee var(--duration, 40s) linear infinite',
        'marquee-vertical': 'marquee-vertical var(--duration, 40s) linear infinite',
        'shimmer': 'shimmer 2.5s linear infinite',
        'gradient': 'gradient 6s ease infinite',
        'orbit': 'orbit calc(var(--duration) * 1s) linear infinite',
        'aurora-1': 'aurora-1 14s ease-in-out infinite alternate',
        'aurora-2': 'aurora-2 18s ease-in-out infinite alternate',
        'aurora-3': 'aurora-3 22s ease-in-out infinite alternate',
        'meteor': 'meteor 5s linear infinite',
        'retro-grid': 'retro-grid 18s linear infinite',
        'rainbow': 'rainbow var(--rainbow-duration, 4s) linear infinite',
        'ripple': 'ripple 600ms ease-out forwards',
        'moving-border': 'moving-border var(--mb-duration, 4s) linear infinite',
        'flicker': 'flicker 3s steps(1, end) infinite',
        'ripple-ring': 'ripple-ring 3s ease-out infinite',
      },
    },
  },
  plugins: [],
};
