p='packages/ui/src/theme.ts'
t=open(p,encoding='utf8',newline='').read()
t=t.replace("  overlay: string; // modal scrim\n};","  gradientFrom: string; // brand gradient start (hero, primary CTA, accents)\n  gradientTo: string; // brand gradient end\n  gradientFg: string; // text/icons placed on the gradient\n  overlay: string; // modal scrim\n};")
t=t.replace("  overlay: 'rgba(20, 23, 30, 0.55)',\n};","  gradientFrom: '#4254C5',\n  gradientTo: '#7A45D6',\n  gradientFg: '#FFFFFF',\n  overlay: 'rgba(20, 23, 30, 0.55)',\n};")
t=t.replace("  overlay: 'rgba(0, 0, 0, 0.65)',\n};","  gradientFrom: '#8C9BFF',\n  gradientTo: '#B79CFF',\n  gradientFg: '#10132B',\n  overlay: 'rgba(0, 0, 0, 0.65)',\n};")
t=t.replace("export const radius = { sm: '6px', md: '10px', lg: '16px', full: '999px' } as const;","export const radius = { sm: '8px', md: '12px', lg: '20px', full: '999px' } as const;")
a=t.index("export const shadow = {")
b=t.index("} as const;",a)+len("} as const;")
t=t[:a]+"""export const shadow = {
  sm: '0 1px 2px rgba(31, 41, 90, 0.06), 0 1px 3px rgba(31, 41, 90, 0.05)',
  md: '0 4px 14px rgba(31, 41, 90, 0.08), 0 2px 4px rgba(31, 41, 90, 0.05)',
  lg: '0 18px 44px rgba(31, 41, 90, 0.16), 0 4px 10px rgba(31, 41, 90, 0.06)',
} as const;"""+t[b:]
t=t.replace("    ['secondary', 'surface', 3, 'icons / large text only'],","    ['secondary', 'surface', 3, 'icons / large text only'],\n    ['gradientFg', 'gradientFrom', 4.5, 'text on the brand gradient (start)'],\n    ['gradientFg', 'gradientTo', 4.5, 'text on the brand gradient (end)'],\n    ['gradientFrom', 'bg', 4.5, 'gradient headline text on page (start)'],\n    ['gradientTo', 'bg', 4.5, 'gradient headline text on page (end)'],")
open(p,'w',encoding='utf8',newline='').write(t)

# css utilities
p='apps/web/src/app/globals.css'
t=open(p,encoding='utf8',newline='').read()
t+='''
/* Reusable look-and-feel built only from theme tokens (colours, radii, shadows come from theme.ts). */
@layer components {
  .bg-brand-gradient {
    background-image: linear-gradient(135deg, var(--if-color-gradient-from), var(--if-color-gradient-to));
    color: var(--if-color-gradient-fg);
  }
  .text-brand-gradient {
    background-image: linear-gradient(100deg, var(--if-color-gradient-from), var(--if-color-gradient-to));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .bg-hero-mesh {
    background-color: var(--if-color-bg);
    background-image:
      radial-gradient(60rem 28rem at 85% -10%, color-mix(in srgb, var(--if-color-gradient-to) 22%, transparent), transparent 70%),
      radial-gradient(48rem 26rem at 0% 0%, color-mix(in srgb, var(--if-color-gradient-from) 20%, transparent), transparent 70%);
  }
  .bg-grid {
    background-image:
      linear-gradient(color-mix(in srgb, var(--if-color-border) 55%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--if-color-border) 55%, transparent) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: radial-gradient(ellipse at 50% 0%, #000 30%, transparent 75%);
  }
  .glass {
    background: color-mix(in srgb, var(--if-color-surface) 78%, transparent);
    backdrop-filter: blur(14px) saturate(1.4);
  }
  .card-lift {
    transition:
      transform var(--if-motion-base) var(--if-motion-easing),
      box-shadow var(--if-motion-base) var(--if-motion-easing),
      border-color var(--if-motion-base) var(--if-motion-easing);
  }
  .card-lift:hover {
    transform: translateY(-3px);
    box-shadow: var(--if-shadow-lg);
    border-color: color-mix(in srgb, var(--if-color-accent) 40%, var(--if-color-border));
  }
  .icon-tile {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--if-radius-md);
    color: var(--if-color-accent);
    background: color-mix(in srgb, var(--if-color-accent) 12%, var(--if-color-surface));
  }
  @keyframes if-rise {
    from {
      opacity: 0;
      transform: translateY(18px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes if-float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-8px);
    }
  }
  @keyframes if-pulse-dot {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--if-color-success) 55%, transparent);
    }
    100% {
      box-shadow: 0 0 0 10px transparent;
    }
  }
  .reveal {
    animation: if-rise 0.7s var(--if-motion-easing) both;
    animation-delay: var(--d, 0ms);
  }
  .float {
    animation: if-float 6s ease-in-out infinite;
  }
  .pulse-dot {
    animation: if-pulse-dot 1.8s ease-out infinite;
  }
  @supports (animation-timeline: view()) {
    .reveal-scroll {
      animation: if-rise linear both;
      animation-timeline: view();
      animation-range: entry 0% entry 30%;
    }
  }
}
'''
open(p,'w',encoding='utf8',newline='').write(t)
