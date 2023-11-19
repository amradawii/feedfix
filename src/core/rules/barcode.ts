import { TrackedString } from '../model';
import { ALL_PLATFORMS, createProblemId, Problem, RuleRunner } from './types';

const SCIENTIFIC_NOTATION_RE = /^[+-]?\d+(?:[.,]\d+)?[eE][+-]?\d+$/;
const VALID_GTIN_LENGTHS = new Set([8, 12, 13, 14]);
const ALL_SAME_DIGITS_RE = /^(\d)\1+$/;

/**
 * Computes the expected GS1 check digit for a numeric payload (without check digit).
 * Operates strictly on characters/strings — barcodes are never parsed as numbers.
 */
export function computeGs1CheckDigit(payloadDigits: string): number {
  let sum = 0;
  let posFromRight = 1;
  for (let i = payloadDigits.length - 1; i >= 0; i--) {
    const digit = payloadDigits.charCodeAt(i) - 48;
    const weight = posFromRight % 2 === 1 ? 3 : 1;
    sum += digit * weight;
    posFromRight++;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGs1CheckDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits) || !VALID_GTIN_LENGTHS.has(digits.length)) {
    return false;
  }
  if (ALL_SAME_DIGITS_RE.test(digits)) {
    return false;
  }
  const payload = digits.slice(0, -1);
  const actual = digits.charCodeAt(digits.length - 1) - 48;
  return computeGs1CheckDigit(payload) === actual;
}

/**
 * Restores a single lost leading zero ONLY from 11 -> 12 digits (UPC-A) or 7 -> 8 digits (EAN-8)
 * when the GS1 check digit proves the restored barcode is valid. Never converts 12 -> 13.
 */
export function tryRestoreLeadingZero(digits: string): string | null {
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length !== 11 && digits.length !== 7) return null;
  const candidate = `0${digits}`;
  if (ALL_SAME_DIGITS_RE.test(candidate)) return null;
  return isValidGs1CheckDigit(candidate) ? candidate : null;
}

function collectBarcodes(catalog: {
  products: Array<{ variants: Array<{ barcode?: TrackedString }> }>;
}): TrackedString[] {
  const out: TrackedString[] = [];
  for (const product of catalog.products) {
    for (const variant of product.variants) {
      if (variant.barcode) {
        out.push(variant.barcode);
      }
    }
  }
  return out;
}

export const barcodeScientificNotationRule: RuleRunner = {
  meta: {
    id: 'barcode.scientific-notation',
    group: 'barcode',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Barcode turned into scientific notation (unrecoverable)',
    explanation:
      'Excel converted this barcode into a number and rounded away the trailing digits. Re-export from the original source.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const barcode of collectBarcodes(catalog)) {
      if (!SCIENTIFIC_NOTATION_RE.test(barcode.value)) continue;
      problems.push({
        id: createProblemId('barcode.scientific-notation', barcode.ref.row, barcode.ref.col),
        ruleId: 'barcode.scientific-notation',
        group: 'barcode',
        severity: 'fail',
        title: 'Barcode turned into scientific notation (unrecoverable)',
        message: `Barcode "${barcode.value}" was rounded by Excel into scientific notation. The lost digits cannot be recovered.`,
        row: barcode.ref.row,
        col: barcode.ref.col,
        columnName: barcode.ref.columnName,
        rawValue: barcode.ref.raw,
      });
    }
    return problems;
  },
};

export const barcodeAllSameDigitsRule: RuleRunner = {
  meta: {
    id: 'barcode.all-same-digits',
    group: 'barcode',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Barcode uses a single repeated digit',
    explanation:
      'Placeholder codes like 000000000000 are rejected even when they pass checksum math.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const barcode of collectBarcodes(catalog)) {
      if (SCIENTIFIC_NOTATION_RE.test(barcode.value)) continue;
      if (!/^\d{2,}$/.test(barcode.value)) continue;
      if (!ALL_SAME_DIGITS_RE.test(barcode.value)) continue;
      problems.push({
        id: createProblemId('barcode.all-same-digits', barcode.ref.row, barcode.ref.col),
        ruleId: 'barcode.all-same-digits',
        group: 'barcode',
        severity: 'fail',
        title: 'Barcode uses a single repeated digit',
        message: `Barcode "${barcode.value}" repeats the same digit and is not a valid product code.`,
        row: barcode.ref.row,
        col: barcode.ref.col,
        columnName: barcode.ref.columnName,
        rawValue: barcode.ref.raw,
      });
    }
    return problems;
  },
};

export const barcodeLostLeadingZeroRule: RuleRunner = {
  meta: {
    id: 'barcode.lost-leading-zero',
    group: 'barcode',
    severity: 'reject',
    platforms: ALL_PLATFORMS,
    title: 'Barcode lost its leading zero',
    explanation:
      'Excel stripped the leading zero from an 11-digit UPC or 7-digit EAN-8; the check digit confirms the restored code.',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const barcode of collectBarcodes(catalog)) {
      if (SCIENTIFIC_NOTATION_RE.test(barcode.value)) continue;
      if (ALL_SAME_DIGITS_RE.test(barcode.value)) continue;
      const restored = tryRestoreLeadingZero(barcode.value);
      if (!restored) continue;
      problems.push({
        id: createProblemId('barcode.lost-leading-zero', barcode.ref.row, barcode.ref.col),
        ruleId: 'barcode.lost-leading-zero',
        group: 'barcode',
        severity: 'reject',
        title: 'Barcode lost its leading zero',
        message: `Barcode "${barcode.value}" is missing its leading zero (check digit confirms ${restored}).`,
        row: barcode.ref.row,
        col: barcode.ref.col,
        columnName: barcode.ref.columnName,
        rawValue: barcode.ref.raw,
        fix: {
          safe: true,
          description: 'Restore leading zero confirmed by check digit',
          edits: [
            {
              row: barcode.ref.row,
              col: barcode.ref.col,
              columnName: barcode.ref.columnName,
              before: barcode.ref.raw,
              after: restored,
            },
          ],
        },
      });
    }
    return problems;
  },
};

export const barcodeInvalidLengthRule: RuleRunner = {
  meta: {
    id: 'barcode.invalid-length',
    group: 'barcode',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Barcode has invalid length or characters',
    explanation: 'Valid GTIN barcodes contain only digits and must be 8, 12, 13 or 14 digits long.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const barcode of collectBarcodes(catalog)) {
      const val = barcode.value;
      if (SCIENTIFIC_NOTATION_RE.test(val)) continue;
      if (/^\d{2,}$/.test(val) && ALL_SAME_DIGITS_RE.test(val)) continue;
      if (tryRestoreLeadingZero(val)) continue;

      if (!/^\d+$/.test(val)) {
        problems.push({
          id: createProblemId('barcode.invalid-length', barcode.ref.row, barcode.ref.col),
          ruleId: 'barcode.invalid-length',
          group: 'barcode',
          severity: 'fail',
          title: 'Barcode has invalid length or characters',
          message: `Barcode "${val}" contains non-digit characters.`,
          row: barcode.ref.row,
          col: barcode.ref.col,
          columnName: barcode.ref.columnName,
          rawValue: barcode.ref.raw,
        });
        continue;
      }

      if (!VALID_GTIN_LENGTHS.has(val.length)) {
        problems.push({
          id: createProblemId('barcode.invalid-length', barcode.ref.row, barcode.ref.col),
          ruleId: 'barcode.invalid-length',
          group: 'barcode',
          severity: 'fail',
          title: 'Barcode has invalid length or characters',
          message: `Barcode "${val}" has ${val.length} digits (expected 8, 12, 13 or 14).`,
          row: barcode.ref.row,
          col: barcode.ref.col,
          columnName: barcode.ref.columnName,
          rawValue: barcode.ref.raw,
        });
      }
    }
    return problems;
  },
};

export const barcodeInvalidCheckDigitRule: RuleRunner = {
  meta: {
    id: 'barcode.invalid-check-digit',
    group: 'barcode',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Barcode check digit is wrong',
    explanation:
      'The last digit does not match the GS1 checksum, which usually means a typo or cut-off digit.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const barcode of collectBarcodes(catalog)) {
      const val = barcode.value;
      if (!/^\d+$/.test(val) || !VALID_GTIN_LENGTHS.has(val.length)) continue;
      if (ALL_SAME_DIGITS_RE.test(val)) continue;
      if (isValidGs1CheckDigit(val)) continue;

      const expected = computeGs1CheckDigit(val.slice(0, -1));
      problems.push({
        id: createProblemId('barcode.invalid-check-digit', barcode.ref.row, barcode.ref.col),
        ruleId: 'barcode.invalid-check-digit',
        group: 'barcode',
        severity: 'fail',
        title: 'Barcode check digit is wrong',
        message: `Barcode "${val}" fails check-digit validation (expected last digit ${expected}).`,
        row: barcode.ref.row,
        col: barcode.ref.col,
        columnName: barcode.ref.columnName,
        rawValue: barcode.ref.raw,
      });
    }
    return problems;
  },
};

export const BARCODE_RULES: RuleRunner[] = [
  barcodeScientificNotationRule,
  barcodeAllSameDigitsRule,
  barcodeLostLeadingZeroRule,
  barcodeInvalidLengthRule,
  barcodeInvalidCheckDigitRule,
];
