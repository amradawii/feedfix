import { Platform, TrackedString } from '../model';
import { ALL_PLATFORMS, createProblemId, Problem, RuleRunner } from './types';

const ISO_CURRENCIES = new Set([
  'USD',
  'EUR',
  'GBP',
  'EGP',
  'SAR',
  'AED',
  'KWD',
  'QAR',
  'BHD',
  'OMR',
  'JOD',
  'MAD',
  'TND',
  'CAD',
  'AUD',
  'NZD',
  'JPY',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'TRY',
  'INR',
  'BRL',
  'MXN',
  'ZAR',
  'CNY',
  'HKD',
  'SGD',
]);

// Only unambiguous symbols/words map to an ISO code; "$" is intentionally omitted
// because it is ambiguous across USD, CAD, AUD, etc.
const UNAMBIGUOUS_CURRENCY_TOKENS: Array<{ pattern: RegExp; iso: string }> = [
  { pattern: /€/g, iso: 'EUR' },
  { pattern: /£/g, iso: 'GBP' },
  { pattern: /ج\.?\s*م\.?/g, iso: 'EGP' },
  { pattern: /جنيه/g, iso: 'EGP' },
  { pattern: /ر\.?\s*س\.?/g, iso: 'SAR' },
  { pattern: /ريال/g, iso: 'SAR' },
  { pattern: /د\.?\s*إ\.?/g, iso: 'AED' },
  { pattern: /درهم/g, iso: 'AED' },
  { pattern: /\bL\.?E\.?\b/gi, iso: 'EGP' },
  { pattern: /\bS\.?R\.?\b/gi, iso: 'SAR' },
  { pattern: /\bDHS\b/gi, iso: 'AED' },
];

const ARABIC_DIGIT_RE = /[\u0660-\u0669\u06F0-\u06F9\u066B\u066C]/;

export interface ParsedPrice {
  ok: true;
  /** Exact signed integer value scaled by 10^4 (4 decimal places) for floating-point-free comparisons */
  scaledUnits: bigint;
  /** Canonical decimal string with at least 2 decimal places, e.g. "1200.00" or "-5.50" */
  normalizedNumber: string;
  /** Unambiguous ISO-4217 currency code if found in the raw cell */
  isoCurrency?: string;
  hadArabicDigits: boolean;
  hadDecimalComma: boolean;
  hadThousandsSeparator: boolean;
  hadExtraText: boolean;
  isNegative: boolean;
  isZero: boolean;
}

export interface InvalidPrice {
  ok: false;
  hadArabicDigits: boolean;
}

export type PriceParseResult = ParsedPrice | InvalidPrice;

export function normalizeArabicDigits(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0x0660 && code <= 0x0669) {
      out += String(code - 0x0660);
    } else if (code >= 0x06f0 && code <= 0x06f9) {
      out += String(code - 0x06f0);
    } else if (code === 0x066b) {
      out += '.';
    } else if (code === 0x066c) {
      out += ',';
    } else {
      out += input[i];
    }
  }
  return out;
}

function toScaledUnitsAndString(
  negative: boolean,
  intPartRaw: string,
  fracPartRaw: string,
): { scaledUnits: bigint; normalizedNumber: string } {
  const intDigits = intPartRaw.replace(/^0+(?=\d)/, '') || '0';
  const fracClean = fracPartRaw.replace(/[^0-9]/g, '');

  // Exact integer scaling to 4 decimal places (truncate beyond 4 digits only if needed for comparison;
  // retail prices have <= 2-4 decimal places).
  const frac4 = (fracClean + '0000').slice(0, 4);
  const absScaled = BigInt(intDigits) * 10000n + BigInt(frac4);
  const scaledUnits = negative ? -absScaled : absScaled;

  // Format string: preserve exact digits with at least 2 decimal places, never using floating point.
  const displayFrac =
    fracClean.length === 0 ? '00' : fracClean.length === 1 ? `${fracClean}0` : fracClean;
  const sign = negative && absScaled > 0n ? '-' : '';
  return {
    scaledUnits,
    normalizedNumber: `${sign}${intDigits}.${displayFrac}`,
  };
}

export function parsePriceValue(raw: string): PriceParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, hadArabicDigits: false };
  }

  const hadArabicDigits = ARABIC_DIGIT_RE.test(trimmed);
  let work = normalizeArabicDigits(trimmed).replace(/\u00A0/g, ' ');

  let isoCurrency: string | undefined;
  let hadExtraText = false;

  // 1. Check explicit ISO-4217 currency codes at word boundaries
  const isoMatches = work.match(/\b[A-Za-z]{3}\b/g);
  if (isoMatches) {
    for (const token of isoMatches) {
      const upper = token.toUpperCase();
      if (ISO_CURRENCIES.has(upper)) {
        if (isoCurrency && isoCurrency !== upper) {
          // Conflicting currencies in one cell -> unparseable
          return { ok: false, hadArabicDigits };
        }
        isoCurrency = upper;
        work = work.replace(new RegExp(`\\b${token}\\b`, 'g'), ' ');
      }
    }
  }

  // 2. Check unambiguous local currency words/symbols
  for (const entry of UNAMBIGUOUS_CURRENCY_TOKENS) {
    if (entry.pattern.test(work)) {
      if (!isoCurrency) isoCurrency = entry.iso;
      work = work.replace(entry.pattern, ' ');
      hadExtraText = true;
    }
  }

  // 3. Strip ambiguous currency symbols ($, ¥, etc.) without guessing ISO currency
  if (/[$¥₹₩₺]/.test(work)) {
    hadExtraText = true;
    work = work.replace(/[$¥₹₩₺]/g, ' ');
  }

  work = work.trim();

  // Check if any leftover letters or range hyphens remain
  if (/[A-Za-z\u0600-\u06FF]/.test(work)) {
    return { ok: false, hadArabicDigits };
  }

  // Collapse internal spaces only if they are thousands spaces (e.g. "1 200.00")
  if (/^[+-]?\d{1,3}(?:\s\d{3})+(?:[.,]\d{1,4})?$/.test(work)) {
    work = work.replace(/\s+/g, '');
    hadExtraText = true;
  }

  if (/\s/.test(work)) {
    return { ok: false, hadArabicDigits };
  }

  let negative = false;
  if (work.startsWith('-')) {
    negative = true;
    work = work.slice(1);
  } else if (work.startsWith('+')) {
    work = work.slice(1);
    hadExtraText = true;
  }

  let intPart: string;
  let fracPart = '';
  let hadDecimalComma = false;
  let hadThousandsSeparator = false;

  if (/^\d+$/.test(work)) {
    intPart = work;
  } else if (/^\d+\.\d{1,4}$/.test(work)) {
    [intPart, fracPart] = work.split('.');
  } else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?$/.test(work)) {
    // English thousands comma: 1,200 or 1,200.50
    hadThousandsSeparator = true;
    const [i, f] = work.split('.');
    intPart = i.replace(/,/g, '');
    fracPart = f ?? '';
  } else if (/^\d+,\d{1,2}$/.test(work)) {
    // European decimal comma: 12,50 or 12,5
    hadDecimalComma = true;
    [intPart, fracPart] = work.split(',');
  } else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(work)) {
    // European thousands dots + decimal comma: 1.200,50
    hadDecimalComma = true;
    hadThousandsSeparator = true;
    const [i, f] = work.split(',');
    intPart = i.replace(/\./g, '');
    fracPart = f;
  } else {
    return { ok: false, hadArabicDigits };
  }

  const { scaledUnits, normalizedNumber } = toScaledUnitsAndString(negative, intPart, fracPart);

  // Detect whether extra text/currency was present in raw compared to a clean numeric value
  if (isoCurrency) {
    hadExtraText = true;
  }

  return {
    ok: true,
    scaledUnits,
    normalizedNumber,
    isoCurrency,
    hadArabicDigits,
    hadDecimalComma,
    hadThousandsSeparator,
    hadExtraText,
    isNegative: scaledUnits < 0n,
    isZero: scaledUnits === 0n,
  };
}

function formatTargetPrice(parsed: ParsedPrice, platform: Platform): string {
  if (platform === 'google') {
    return parsed.isoCurrency
      ? `${parsed.normalizedNumber} ${parsed.isoCurrency}`
      : parsed.normalizedNumber;
  }
  return parsed.normalizedNumber;
}

function isCleanGooglePriceFormat(raw: string, parsed: ParsedPrice): boolean {
  if (!parsed.isoCurrency) return false;
  const trimmed = raw.trim();
  return /^\d+(?:\.\d{1,4})?\s[A-Z]{3}$/.test(trimmed);
}

interface PriceEntry {
  tracked: TrackedString;
  kind: 'regular' | 'sale';
  parsed: PriceParseResult;
}

function collectPriceEntries(catalog: {
  products: Array<{ variants: Array<{ regularPrice?: TrackedString; salePrice?: TrackedString }> }>;
}): PriceEntry[] {
  const entries: PriceEntry[] = [];
  for (const product of catalog.products) {
    for (const variant of product.variants) {
      if (variant.regularPrice) {
        entries.push({
          tracked: variant.regularPrice,
          kind: 'regular',
          parsed: parsePriceValue(variant.regularPrice.value),
        });
      }
      if (variant.salePrice) {
        entries.push({
          tracked: variant.salePrice,
          kind: 'sale',
          parsed: parsePriceValue(variant.salePrice.value),
        });
      }
    }
  }
  return entries;
}

/**
 * Classifies the single primary formatting fix for a price cell so multiple format rules
 * never propose overlapping edits on the same (row, col).
 */
function classifyPriceFormatRule(
  raw: string,
  parsed: ParsedPrice,
  platform: Platform,
): 'price.arabic-digits' | 'price.decimal-comma' | 'price.text-or-currency' | null {
  if (parsed.hadArabicDigits) {
    return 'price.arabic-digits';
  }
  if (parsed.hadDecimalComma) {
    return 'price.decimal-comma';
  }
  if (platform === 'google') {
    if (
      parsed.hadThousandsSeparator ||
      (!isCleanGooglePriceFormat(raw, parsed) && parsed.isoCurrency)
    ) {
      return 'price.text-or-currency';
    }
    if (!parsed.isoCurrency && parsed.hadExtraText) {
      return 'price.text-or-currency';
    }
    return null;
  }

  if (parsed.hadExtraText || parsed.hadThousandsSeparator) {
    return 'price.text-or-currency';
  }
  return null;
}

export const priceArabicDigitsRule: RuleRunner = {
  meta: {
    id: 'price.arabic-digits',
    group: 'price',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Price uses Arabic-Indic digits',
    explanation: 'Platforms require Western digits (0-9) in price columns.',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const entry of collectPriceEntries(catalog)) {
      if (!entry.parsed.ok) continue;
      if (
        classifyPriceFormatRule(entry.tracked.ref.raw, entry.parsed, catalog.platform) !==
        'price.arabic-digits'
      ) {
        continue;
      }
      const after = formatTargetPrice(entry.parsed, catalog.platform);
      problems.push({
        id: createProblemId('price.arabic-digits', entry.tracked.ref.row, entry.tracked.ref.col),
        ruleId: 'price.arabic-digits',
        group: 'price',
        severity: 'fail',
        title: 'Price uses Arabic-Indic digits',
        message: `Price uses Arabic-Indic digits: ${entry.tracked.value}`,
        row: entry.tracked.ref.row,
        col: entry.tracked.ref.col,
        columnName: entry.tracked.ref.columnName,
        rawValue: entry.tracked.ref.raw,
        fix: {
          safe: true,
          description: 'Convert Arabic-Indic digits to standard numbers',
          edits: [
            {
              row: entry.tracked.ref.row,
              col: entry.tracked.ref.col,
              columnName: entry.tracked.ref.columnName,
              before: entry.tracked.ref.raw,
              after,
            },
          ],
        },
      });
    }
    return problems;
  },
};

export const priceDecimalCommaRule: RuleRunner = {
  meta: {
    id: 'price.decimal-comma',
    group: 'price',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Price uses a decimal comma',
    explanation: 'Use a period instead of a comma for decimals so platforms read the right amount.',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const entry of collectPriceEntries(catalog)) {
      if (!entry.parsed.ok) continue;
      if (
        classifyPriceFormatRule(entry.tracked.ref.raw, entry.parsed, catalog.platform) !==
        'price.decimal-comma'
      ) {
        continue;
      }
      const after = formatTargetPrice(entry.parsed, catalog.platform);
      problems.push({
        id: createProblemId('price.decimal-comma', entry.tracked.ref.row, entry.tracked.ref.col),
        ruleId: 'price.decimal-comma',
        group: 'price',
        severity: 'fail',
        title: 'Price uses a decimal comma',
        message: `Price uses a decimal comma: ${entry.tracked.value}`,
        row: entry.tracked.ref.row,
        col: entry.tracked.ref.col,
        columnName: entry.tracked.ref.columnName,
        rawValue: entry.tracked.ref.raw,
        fix: {
          safe: true,
          description: 'Replace decimal comma with a period',
          edits: [
            {
              row: entry.tracked.ref.row,
              col: entry.tracked.ref.col,
              columnName: entry.tracked.ref.columnName,
              before: entry.tracked.ref.raw,
              after,
            },
          ],
        },
      });
    }
    return problems;
  },
};

export const priceTextOrCurrencyRule: RuleRunner = {
  meta: {
    id: 'price.text-or-currency',
    group: 'price',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Price has text in it',
    explanation:
      'Price cells should contain a plain number (plus ISO currency code for Google feeds).',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const entry of collectPriceEntries(catalog)) {
      if (!entry.parsed.ok) continue;
      if (
        classifyPriceFormatRule(entry.tracked.ref.raw, entry.parsed, catalog.platform) !==
        'price.text-or-currency'
      ) {
        continue;
      }
      const after = formatTargetPrice(entry.parsed, catalog.platform);
      if (after === entry.tracked.ref.raw) continue;
      problems.push({
        id: createProblemId('price.text-or-currency', entry.tracked.ref.row, entry.tracked.ref.col),
        ruleId: 'price.text-or-currency',
        group: 'price',
        severity: 'fail',
        title: 'Price has text in it',
        message: `Price has text in it: ${entry.tracked.value}`,
        row: entry.tracked.ref.row,
        col: entry.tracked.ref.col,
        columnName: entry.tracked.ref.columnName,
        rawValue: entry.tracked.ref.raw,
        fix: {
          safe: true,
          description: 'Clean currency symbols and thousands separators from price',
          edits: [
            {
              row: entry.tracked.ref.row,
              col: entry.tracked.ref.col,
              columnName: entry.tracked.ref.columnName,
              before: entry.tracked.ref.raw,
              after,
            },
          ],
        },
      });
    }
    return problems;
  },
};

export const priceInvalidRule: RuleRunner = {
  meta: {
    id: 'price.invalid',
    group: 'price',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Price is not a valid number',
    explanation: 'This price cannot be safely converted into a single number.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const entry of collectPriceEntries(catalog)) {
      if (entry.parsed.ok) continue;
      problems.push({
        id: createProblemId('price.invalid', entry.tracked.ref.row, entry.tracked.ref.col),
        ruleId: 'price.invalid',
        group: 'price',
        severity: 'fail',
        title: 'Price is not a valid number',
        message: `Could not read price "${entry.tracked.value}" as a number.`,
        row: entry.tracked.ref.row,
        col: entry.tracked.ref.col,
        columnName: entry.tracked.ref.columnName,
        rawValue: entry.tracked.ref.raw,
      });
    }
    return problems;
  },
};

export const priceNegativeRule: RuleRunner = {
  meta: {
    id: 'price.negative',
    group: 'price',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Negative price',
    explanation: 'Product prices cannot be below zero.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const entry of collectPriceEntries(catalog)) {
      if (!entry.parsed.ok || !entry.parsed.isNegative) continue;
      problems.push({
        id: createProblemId('price.negative', entry.tracked.ref.row, entry.tracked.ref.col),
        ruleId: 'price.negative',
        group: 'price',
        severity: 'fail',
        title: 'Negative price',
        message: `Price is negative: ${entry.tracked.value}`,
        row: entry.tracked.ref.row,
        col: entry.tracked.ref.col,
        columnName: entry.tracked.ref.columnName,
        rawValue: entry.tracked.ref.raw,
      });
    }
    return problems;
  },
};

export const priceZeroRule: RuleRunner = {
  meta: {
    id: 'price.zero',
    group: 'price',
    severity: 'reject',
    platforms: ALL_PLATFORMS,
    title: 'Price is zero',
    explanation:
      'Zero-priced products are rejected by Google Merchant Center and usually indicate a missing price.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const entry of collectPriceEntries(catalog)) {
      if (!entry.parsed.ok || !entry.parsed.isZero) continue;
      problems.push({
        id: createProblemId('price.zero', entry.tracked.ref.row, entry.tracked.ref.col),
        ruleId: 'price.zero',
        group: 'price',
        severity: 'reject',
        title: 'Price is zero',
        message: `Price is zero: ${entry.tracked.value}`,
        row: entry.tracked.ref.row,
        col: entry.tracked.ref.col,
        columnName: entry.tracked.ref.columnName,
        rawValue: entry.tracked.ref.raw,
      });
    }
    return problems;
  },
};

export const priceMissingCurrencyRule: RuleRunner = {
  meta: {
    id: 'price.missing-currency',
    group: 'price',
    severity: 'fail',
    platforms: ['google'],
    title: 'Google price is missing currency code',
    explanation:
      'Google Merchant Center requires a 3-letter ISO currency code after the price (e.g. 15.00 USD).',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'google') return [];
    const problems: Problem[] = [];
    for (const entry of collectPriceEntries(catalog)) {
      if (!entry.parsed.ok || entry.parsed.isoCurrency) continue;
      problems.push({
        id: createProblemId('price.missing-currency', entry.tracked.ref.row, entry.tracked.ref.col),
        ruleId: 'price.missing-currency',
        group: 'price',
        severity: 'fail',
        title: 'Google price is missing currency code',
        message: `Price "${entry.tracked.value}" is missing a 3-letter currency code (for example: ${entry.parsed.normalizedNumber} USD).`,
        row: entry.tracked.ref.row,
        col: entry.tracked.ref.col,
        columnName: entry.tracked.ref.columnName,
        rawValue: entry.tracked.ref.raw,
      });
    }
    return problems;
  },
};

export const priceSaleGteRegularRule: RuleRunner = {
  meta: {
    id: 'price.sale-gte-regular',
    group: 'price',
    severity: 'reject',
    platforms: ALL_PLATFORMS,
    title: 'Sale price is higher than or equal to regular price',
    explanation:
      'The discounted price must be lower than the regular price. Review before swapping the two columns.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];

    for (const product of catalog.products) {
      for (const variant of product.variants) {
        if (!variant.regularPrice || !variant.salePrice) continue;
        const reg = parsePriceValue(variant.regularPrice.value);
        const sale = parsePriceValue(variant.salePrice.value);
        if (!reg.ok || !sale.ok) continue;
        if (reg.isNegative || sale.isNegative) continue;

        if (sale.scaledUnits >= reg.scaledUnits) {
          const isEqual = sale.scaledUnits === reg.scaledUnits;
          problems.push({
            id: createProblemId(
              'price.sale-gte-regular',
              variant.salePrice.ref.row,
              variant.salePrice.ref.col,
            ),
            ruleId: 'price.sale-gte-regular',
            group: 'price',
            severity: 'reject',
            title: 'Sale price is higher than or equal to regular price',
            message: isEqual
              ? `Sale price (${variant.salePrice.value}) equals regular price (${variant.regularPrice.value}).`
              : `Sale price (${variant.salePrice.value}) is higher than regular price (${variant.regularPrice.value}).`,
            row: variant.salePrice.ref.row,
            col: variant.salePrice.ref.col,
            columnName: variant.salePrice.ref.columnName,
            rawValue: `${variant.salePrice.value} vs ${variant.regularPrice.value}`,
            fix: isEqual
              ? undefined
              : {
                  safe: false,
                  description: 'Swap regular price and sale price',
                  edits: [
                    {
                      row: variant.regularPrice.ref.row,
                      col: variant.regularPrice.ref.col,
                      columnName: variant.regularPrice.ref.columnName,
                      before: variant.regularPrice.ref.raw,
                      after: variant.salePrice.ref.raw,
                    },
                    {
                      row: variant.salePrice.ref.row,
                      col: variant.salePrice.ref.col,
                      columnName: variant.salePrice.ref.columnName,
                      before: variant.salePrice.ref.raw,
                      after: variant.regularPrice.ref.raw,
                    },
                  ],
                },
          });
        }
      }
    }

    return problems;
  },
};

export const PRICE_RULES: RuleRunner[] = [
  priceArabicDigitsRule,
  priceDecimalCommaRule,
  priceTextOrCurrencyRule,
  priceInvalidRule,
  priceNegativeRule,
  priceZeroRule,
  priceMissingCurrencyRule,
  priceSaleGteRegularRule,
];
