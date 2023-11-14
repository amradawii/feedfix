import { normalizeHeader, Platform } from './model';

export interface PlatformDetection {
  platform: Platform;
  label: string;
  confidence: 'high' | 'medium' | 'low';
  matchedHeaders: string[];
  scores: Record<Exclude<Platform, 'other'>, number>;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  shopify: 'Shopify product CSV',
  woocommerce: 'WooCommerce product CSV',
  google: 'Google Merchant Center feed',
  other: 'Other CSV',
};

interface SignatureRule {
  aliases: string[];
  weight: number;
}

const SHOPIFY_SIGNATURES: SignatureRule[] = [
  { aliases: ['handle'], weight: 4 },
  { aliases: ['body (html)'], weight: 4 },
  { aliases: ['variant price'], weight: 4 },
  { aliases: ['variant sku'], weight: 4 },
  { aliases: ['variant compare at price'], weight: 3 },
  { aliases: ['variant barcode'], weight: 3 },
  { aliases: ['variant grams'], weight: 3 },
  { aliases: ['variant inventory qty'], weight: 3 },
  { aliases: ['variant inventory policy'], weight: 3 },
  { aliases: ['variant fulfillment service'], weight: 3 },
  { aliases: ['option1 name'], weight: 3 },
  { aliases: ['option1 value'], weight: 3 },
  { aliases: ['image src'], weight: 3 },
  { aliases: ['product category', 'standardized product type'], weight: 3 },
  { aliases: ['vendor'], weight: 2 },
  { aliases: ['published'], weight: 1 },
  { aliases: ['status'], weight: 1 },
  { aliases: ['title'], weight: 1 },
];

const WOOCOMMERCE_SIGNATURES: SignatureRule[] = [
  { aliases: ['regular price'], weight: 4 },
  { aliases: ['in stock?'], weight: 4 },
  { aliases: ['visibility in catalog'], weight: 4 },
  { aliases: ['is featured?'], weight: 3 },
  { aliases: ['sale price'], weight: 3 },
  { aliases: ['attribute 1 name'], weight: 4 },
  { aliases: ['attribute 1 value(s)'], weight: 4 },
  { aliases: ['parent'], weight: 3 },
  { aliases: ['short description'], weight: 3 },
  { aliases: ['tax status'], weight: 3 },
  { aliases: ['backorders allowed?'], weight: 3 },
  { aliases: ['weight (kg)', 'weight (g)', 'weight (lbs)', 'weight (oz)'], weight: 3 },
  { aliases: ['type'], weight: 1 },
  { aliases: ['sku'], weight: 1 },
  { aliases: ['name'], weight: 1 },
  { aliases: ['published'], weight: 1 },
  { aliases: ['categories'], weight: 1 },
  { aliases: ['images'], weight: 1 },
];

const GOOGLE_SIGNATURES: SignatureRule[] = [
  { aliases: ['image_link', 'image link'], weight: 4 },
  { aliases: ['availability'], weight: 4 },
  { aliases: ['item_group_id', 'item group id'], weight: 4 },
  { aliases: ['google_product_category', 'google product category'], weight: 4 },
  { aliases: ['identifier_exists', 'identifier exists'], weight: 4 },
  { aliases: ['availability_date', 'availability date'], weight: 3 },
  { aliases: ['additional_image_link', 'additional image link'], weight: 3 },
  { aliases: ['shipping_weight', 'shipping weight'], weight: 3 },
  { aliases: ['gtin'], weight: 3 },
  { aliases: ['mpn'], weight: 2 },
  { aliases: ['condition'], weight: 2 },
  { aliases: ['brand'], weight: 2 },
  { aliases: ['link'], weight: 2 },
  { aliases: ['sale_price'], weight: 3 },
  { aliases: ['product_type'], weight: 3 },
  { aliases: ['id'], weight: 1 },
  { aliases: ['title'], weight: 1 },
  { aliases: ['description'], weight: 1 },
  { aliases: ['price'], weight: 1 },
];

export function getPlatformLabel(platform: Platform): string {
  return PLATFORM_LABELS[platform];
}

function scoreHeaders(
  normalizedSet: Set<string>,
  originalByNorm: Map<string, string>,
  rules: SignatureRule[],
): { score: number; matched: string[]; strongMatches: number } {
  let score = 0;
  let strongMatches = 0;
  const matched: string[] = [];

  for (const rule of rules) {
    const hit = rule.aliases.find((alias) => normalizedSet.has(alias));
    if (hit) {
      score += rule.weight;
      if (rule.weight >= 3) strongMatches++;
      matched.push(originalByNorm.get(hit) ?? hit);
    }
  }

  return { score, matched, strongMatches };
}

export function detectPlatform(headers: string[]): PlatformDetection {
  const normalizedSet = new Set<string>();
  const originalByNorm = new Map<string, string>();

  for (const h of headers) {
    const norm = normalizeHeader(h);
    if (norm && !normalizedSet.has(norm)) {
      normalizedSet.add(norm);
      originalByNorm.set(norm, h.replace(/^\uFEFF/, '').trim());
    }
  }

  const shopify = scoreHeaders(normalizedSet, originalByNorm, SHOPIFY_SIGNATURES);
  const woocommerce = scoreHeaders(normalizedSet, originalByNorm, WOOCOMMERCE_SIGNATURES);
  const google = scoreHeaders(normalizedSet, originalByNorm, GOOGLE_SIGNATURES);

  const scores = {
    shopify: shopify.score,
    woocommerce: woocommerce.score,
    google: google.score,
  };

  const ranked: Array<{
    platform: Exclude<Platform, 'other'>;
    score: number;
    strongMatches: number;
    matched: string[];
  }> = [
    { platform: 'shopify' as const, ...shopify },
    { platform: 'woocommerce' as const, ...woocommerce },
    { platform: 'google' as const, ...google },
  ].sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const runnerUp = ranked[1];

  if (top.score >= 6 && top.strongMatches >= 1) {
    const confidence = top.score >= 12 && top.score - runnerUp.score >= 4 ? 'high' : 'medium';
    return {
      platform: top.platform,
      label: PLATFORM_LABELS[top.platform],
      confidence,
      matchedHeaders: top.matched,
      scores,
    };
  }

  return {
    platform: 'other',
    label: PLATFORM_LABELS.other,
    confidence: 'low',
    matchedHeaders: [],
    scores,
  };
}
