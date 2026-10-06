/** The organisation's name, tagline and colour palette (FR-0855), read from the public branding endpoint. */
export interface Branding {
  productName: string;
  tagline: string;
  palette: 'INDIGO' | 'TEAL' | 'CRIMSON' | 'FOREST' | 'SLATE';
  supportEmail: string;
}

export const DEFAULT_BRANDING: Branding = {
  productName: 'Intuitive Fusion',
  tagline: '',
  palette: 'INDIGO',
  supportEmail: '',
};
const PALETTES = ['INDIGO', 'TEAL', 'CRIMSON', 'FOREST', 'SLATE'];
const API = process.env.API_URL ?? 'http://localhost:4000';

/** Never throws: if the API is slow or down, the portal shows the standard name and colours. */
export async function getBranding(): Promise<Branding> {
  try {
    const r = await fetch(`${API}/api/v1/branding`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return DEFAULT_BRANDING;
    const b = (await r.json()) as Partial<Branding>;
    return {
      productName:
        typeof b.productName === 'string' && b.productName.trim()
          ? b.productName
          : DEFAULT_BRANDING.productName,
      tagline: typeof b.tagline === 'string' ? b.tagline : '',
      palette: PALETTES.includes(b.palette ?? '') ? (b.palette as Branding['palette']) : 'INDIGO',
      supportEmail: typeof b.supportEmail === 'string' ? b.supportEmail : '',
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}
