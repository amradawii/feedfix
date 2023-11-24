export interface GoogleTaxonomy {
  version: string;
  size: number;
  hasId: (id: string) => boolean;
  hasName: (name: string) => boolean;
  isValid: (value: string) => boolean;
  getNameById: (id: string) => string | undefined;
}

let cachedTaxonomy: GoogleTaxonomy | null = null;
let loadingPromise: Promise<GoogleTaxonomy> | null = null;

export function parseGoogleTaxonomyText(rawText: string): GoogleTaxonomy {
  const byId = new Map<string, string>();
  const byLowerName = new Map<string, string>();
  let version = '2021-09-21';

  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      const verMatch = trimmed.match(/Google_Product_Taxonomy_Version:\s*(\S+)/);
      if (verMatch) {
        version = verMatch[1];
      }
      continue;
    }

    const sep = trimmed.indexOf(' - ');
    if (sep <= 0) continue;
    const id = trimmed.slice(0, sep).trim();
    const name = trimmed.slice(sep + 3).trim();
    if (id && name) {
      byId.set(id, name);
      byLowerName.set(name.toLowerCase(), id);
    }
  }

  return {
    version,
    size: byId.size,
    hasId: (id: string) => byId.has(id.trim()),
    hasName: (name: string) => byLowerName.has(name.trim().toLowerCase()),
    isValid: (value: string) => {
      const clean = value.trim();
      if (!clean) return false;
      if (/^\d+$/.test(clean)) {
        return byId.has(clean);
      }
      return byLowerName.has(clean.toLowerCase());
    },
    getNameById: (id: string) => byId.get(id.trim()),
  };
}

/**
 * Lazy-loads the official 2021-09-21 Google Product Taxonomy in its own Vite chunk.
 * Called only when a Google Merchant Center feed is being checked or exported.
 */
export async function loadGoogleTaxonomy(): Promise<GoogleTaxonomy> {
  if (cachedTaxonomy) return cachedTaxonomy;
  if (!loadingPromise) {
    loadingPromise = import('../data/google-taxonomy-2021-09-21.txt?raw').then((mod) => {
      cachedTaxonomy = parseGoogleTaxonomyText(mod.default);
      return cachedTaxonomy;
    });
  }
  return loadingPromise;
}
