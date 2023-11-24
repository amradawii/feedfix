import { TrackedString } from '../model';
import { ALL_PLATFORMS, createProblemId, Problem, RuleRunner } from './types';

const HTML_TAG_RE = /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>/i;

const GOOGLE_PROMO_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfree\s+shipping\b/i, label: 'free shipping' },
  { pattern: /\bfree\s+delivery\b/i, label: 'free delivery' },
  { pattern: /\b(?:on\s+)?sale\b/i, label: 'sale' },
  { pattern: /\b\d{1,2}%\s*off\b/i, label: '% off' },
  { pattern: /\bdiscount(?:ed)?\b/i, label: 'discount' },
  { pattern: /\bbest\s+price\b/i, label: 'best price' },
  { pattern: /\bbuy\s+now\b/i, label: 'buy now' },
  { pattern: /\blimited\s+time\b/i, label: 'limited time' },
  { pattern: /\bhot\s+deal\b/i, label: 'hot deal' },
  { pattern: /\bclearance\b/i, label: 'clearance' },
  { pattern: /شحن\s+مجاني/, label: 'شحن مجاني' },
  { pattern: /تخفيض/, label: 'تخفيض' },
  { pattern: /عرض\s+خاص/, label: 'عرض خاص' },
];

function isAllCapsLatin(text: string): boolean {
  const letters = text.match(/[A-Za-z]/g);
  if (!letters || letters.length < 4) return false;
  return letters.every((ch) => ch === ch.toUpperCase());
}

export const textHtmlInTitleRule: RuleRunner = {
  meta: {
    id: 'text.html-in-title',
    group: 'text',
    severity: 'reject',
    platforms: ALL_PLATFORMS,
    title: 'HTML tags inside product title',
    explanation: 'Titles should be plain text without HTML tags like <b> or <br>.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const product of catalog.products) {
      if (!product.title) continue;
      if (!HTML_TAG_RE.test(product.title.value)) continue;
      problems.push({
        id: createProblemId('text.html-in-title', product.title.ref.row, product.title.ref.col),
        ruleId: 'text.html-in-title',
        group: 'text',
        severity: 'reject',
        title: 'HTML tags inside product title',
        message: `Title contains HTML tags: "${product.title.value}"`,
        row: product.title.ref.row,
        col: product.title.ref.col,
        columnName: product.title.ref.columnName,
        rawValue: product.title.ref.raw,
      });
    }
    return problems;
  },
};

export const textAllCapsTitleRule: RuleRunner = {
  meta: {
    id: 'text.all-caps-title',
    group: 'text',
    severity: 'reject',
    platforms: ALL_PLATFORMS,
    title: 'Product title is in ALL CAPS',
    explanation:
      'Google Merchant Center disapproves all-uppercase titles, and storefronts read better in title case.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const product of catalog.products) {
      if (!product.title) continue;
      if (!isAllCapsLatin(product.title.value)) continue;
      problems.push({
        id: createProblemId('text.all-caps-title', product.title.ref.row, product.title.ref.col),
        ruleId: 'text.all-caps-title',
        group: 'text',
        severity: 'reject',
        title: 'Product title is in ALL CAPS',
        message: `Title is written in all capital letters: "${product.title.value}"`,
        row: product.title.ref.row,
        col: product.title.ref.col,
        columnName: product.title.ref.columnName,
        rawValue: product.title.ref.raw,
      });
    }
    return problems;
  },
};

export const textLengthLimitRule: RuleRunner = {
  meta: {
    id: 'text.length-limit',
    group: 'text',
    severity: 'reject',
    platforms: ['shopify', 'google'],
    title: 'Text exceeds platform length limit',
    explanation: 'Values longer than the platform limit are truncated or rejected on import.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];

    const checkMax = (tracked: TrackedString | undefined, max: number, label: string) => {
      if (!tracked) return;
      if (tracked.value.length <= max) return;
      problems.push({
        id: createProblemId('text.length-limit', tracked.ref.row, tracked.ref.col),
        ruleId: 'text.length-limit',
        group: 'text',
        severity: 'reject',
        title: 'Text exceeds platform length limit',
        message: `${label} is ${tracked.value.length} characters (maximum is ${max}).`,
        row: tracked.ref.row,
        col: tracked.ref.col,
        columnName: tracked.ref.columnName,
        rawValue: tracked.ref.raw,
      });
    };

    if (catalog.platform === 'google') {
      for (const product of catalog.products) {
        checkMax(product.title, 150, 'Google title');
        checkMax(product.descriptionHtml, 5000, 'Google description');
        checkMax(product.vendor, 70, 'Google brand');
        checkMax(product.itemGroupId, 50, 'Google item_group_id');
        for (const variant of product.variants) {
          checkMax(variant.id, 50, 'Google id');
          checkMax(variant.mpn, 70, 'Google mpn');
        }
      }
    } else if (catalog.platform === 'shopify') {
      for (const product of catalog.products) {
        checkMax(product.handle, 255, 'Shopify Handle');
        checkMax(product.title, 255, 'Shopify Title');
      }
    }

    return problems;
  },
};

export const textGooglePromoTitleRule: RuleRunner = {
  meta: {
    id: 'text.google-promo-title',
    group: 'text',
    severity: 'reject',
    platforms: ['google'],
    title: 'Promotional text in Google title',
    explanation:
      'Google Merchant Center rejects titles containing promo phrases like "free shipping" or "sale".',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'google') return [];
    const problems: Problem[] = [];

    for (const product of catalog.products) {
      if (!product.title) continue;
      const hit = GOOGLE_PROMO_PATTERNS.find((p) => p.pattern.test(product.title!.value));
      if (!hit) continue;
      problems.push({
        id: createProblemId(
          'text.google-promo-title',
          product.title.ref.row,
          product.title.ref.col,
        ),
        ruleId: 'text.google-promo-title',
        group: 'text',
        severity: 'reject',
        title: 'Promotional text in Google title',
        message: `Title contains promotional wording ("${hit.label}"): "${product.title.value}"`,
        row: product.title.ref.row,
        col: product.title.ref.col,
        columnName: product.title.ref.columnName,
        rawValue: product.title.ref.raw,
      });
    }

    return problems;
  },
};

export const textWhitespaceRule: RuleRunner = {
  meta: {
    id: 'text.whitespace',
    group: 'text',
    severity: 'tip',
    platforms: ALL_PLATFORMS,
    title: 'Extra leading, trailing or double spaces',
    explanation:
      'Stray spaces around titles, SKUs, handles or brands can break matching and look messy.',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    const seenCells = new Set<string>();

    const checkCell = (tracked: TrackedString | undefined) => {
      if (!tracked) return;
      const key = `${tracked.ref.row}:${tracked.ref.col}`;
      if (seenCells.has(key)) return;
      seenCells.add(key);

      const raw = tracked.ref.raw;
      // Skip multi-line strings (such as HTML descriptions) to avoid touching intentional layout.
      if (raw.includes('\n') || raw.includes('\r')) return;

      const cleaned = raw.trim().replace(/ {2,}/g, ' ');
      if (cleaned !== raw) {
        problems.push({
          id: createProblemId('text.whitespace', tracked.ref.row, tracked.ref.col),
          ruleId: 'text.whitespace',
          group: 'text',
          severity: 'tip',
          title: 'Extra leading, trailing or double spaces',
          message: `Extra spaces in ${tracked.ref.columnName}: "${raw}"`,
          row: tracked.ref.row,
          col: tracked.ref.col,
          columnName: tracked.ref.columnName,
          rawValue: raw,
          fix: {
            safe: true,
            description: 'Trim outer spaces and collapse double spaces',
            edits: [
              {
                row: tracked.ref.row,
                col: tracked.ref.col,
                columnName: tracked.ref.columnName,
                before: raw,
                after: cleaned,
              },
            ],
          },
        });
      }
    };

    for (const product of catalog.products) {
      checkCell(product.handle);
      checkCell(product.title);
      checkCell(product.vendor);
      checkCell(product.itemGroupId);
      for (const variant of product.variants) {
        checkCell(variant.sku);
        checkCell(variant.id);
      }
    }

    return problems;
  },
};

export const TEXT_RULES: RuleRunner[] = [
  textHtmlInTitleRule,
  textAllCapsTitleRule,
  textLengthLimitRule,
  textGooglePromoTitleRule,
  textWhitespaceRule,
];
