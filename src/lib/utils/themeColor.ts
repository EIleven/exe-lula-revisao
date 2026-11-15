import type React from 'react';

export const PROFILE_ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: 'Azul padrão', hex: '#2563eb' },
  { name: 'Vermelho', hex: '#dc2626' },
  { name: 'Verde', hex: '#16a34a' },
  { name: 'Roxo', hex: '#9333ea' },
  { name: 'Rosa', hex: '#db2777' },
  { name: 'Laranja', hex: '#ea580c' },
  { name: 'Ciano', hex: '#0891b2' },
  { name: 'Dourado', hex: '#ca8a04' },
];

export function isValidHexColor(hex?: string | null): hex is string {
  return typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!isValidHexColor(hex)) return null;
  const clean = hex.slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function hexToHslComponents(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function getContrastForegroundHsl(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '0 0% 98%';
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.62 ? '0 0% 9%' : '0 0% 98%';
}

const DEFAULT_ACCENT_STYLE: React.CSSProperties = {
  '--primary': '228, 90%, 55%',
  '--primary-foreground': '9 21% 86%',
  '--accent': '228, 90%, 55%',
  '--accent-foreground': '9 21% 86%',
  '--ring': '228, 90%, 55%',
  '--sidebar-primary': '228, 90%, 55%',
  '--sidebar-primary-foreground': '9 21% 86%',
  '--sidebar-accent': '228, 90%, 55%',
  '--sidebar-accent-foreground': '9 21% 86%',
  '--sidebar-ring': '228, 90%, 55%',
} as React.CSSProperties;

export function getProfileAccentStyle(
  accentColor?: string | null,
  options?: { fallbackToDefault?: boolean }
): React.CSSProperties | undefined {
  if (!isValidHexColor(accentColor)) {
    return options?.fallbackToDefault ? DEFAULT_ACCENT_STYLE : undefined;
  }
  const hsl = hexToHslComponents(accentColor);
  if (!hsl) {
    return options?.fallbackToDefault ? DEFAULT_ACCENT_STYLE : undefined;
  }
  const fg = getContrastForegroundHsl(accentColor);
  return {
    '--primary': hsl,
    '--primary-foreground': fg,
    '--accent': hsl,
    '--accent-foreground': fg,
    '--ring': hsl,
    '--sidebar-primary': hsl,
    '--sidebar-primary-foreground': fg,
    '--sidebar-accent': hsl,
    '--sidebar-accent-foreground': fg,
    '--sidebar-ring': hsl,
  } as React.CSSProperties;
}

const ACCENT_CSS_VARS = [
  '--primary',
  '--primary-foreground',
  '--accent',
  '--accent-foreground',
  '--ring',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-ring',
] as const;

export function applyDocumentAccentColor(accentColor?: string | null): void {
  if (typeof document === 'undefined') return;
  const rootStyle = document.documentElement.style;
  const vars = getProfileAccentStyle(accentColor);
  if (!vars) {
    for (const key of ACCENT_CSS_VARS) {
      rootStyle.removeProperty(key);
    }
    return;
  }
  const record = vars as Record<string, string>;
  for (const key of ACCENT_CSS_VARS) {
    if (record[key]) {
      rootStyle.setProperty(key, record[key]);
    }
  }
}

