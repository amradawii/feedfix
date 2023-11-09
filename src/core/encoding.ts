export type DetectedEncoding =
  | 'utf-8'
  | 'utf-8-bom'
  | 'utf-16le'
  | 'utf-16be'
  | 'windows-1256'
  | 'windows-1252';

export interface DecodeResult {
  text: string;
  encoding: DetectedEncoding;
  encodingLabel: string;
  hasBom: boolean;
  mojibakeDetected: boolean;
  unrecoverableQuestionMarks: boolean;
}

export interface MojibakeRepairResult {
  text: string;
  changed: boolean;
}

const ENCODING_LABELS: Record<DetectedEncoding, string> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8 (BOM)',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'windows-1256': 'Windows-1256 (Arabic)',
  'windows-1252': 'Windows-1252',
};

// WHATWG Windows-1252 reverse map for code points mapped into bytes 0x80..0x9F.
const WIN1252_EXTRA_REVERSE = new Map<number, number>([
  [0x20ac, 0x80], // €
  [0x201a, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201e, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02c6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8a], // Š
  [0x2039, 0x8b], // ‹
  [0x0152, 0x8c], // Œ
  [0x017d, 0x8e], // Ž
  [0x2018, 0x91], // ‘
  [0x2019, 0x92], // ’
  [0x201c, 0x93], // “
  [0x201d, 0x94], // ”
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02dc, 0x98], // ˜
  [0x2122, 0x99], // ™
  [0x0161, 0x9a], // š
  [0x203a, 0x9b], // ›
  [0x0153, 0x9c], // œ
  [0x017e, 0x9e], // ž
  [0x0178, 0x9f], // Ÿ
]);

const UNRECOVERABLE_QMARK_RE = /\?{3,}|\uFFFD/;

export function charToWin1252Byte(codePoint: number): number | null {
  if (codePoint <= 0xff) {
    return codePoint;
  }
  const mapped = WIN1252_EXTRA_REVERSE.get(codePoint);
  return mapped !== undefined ? mapped : null;
}

function isArabicLetter(code: number): boolean {
  return (code >= 0x0621 && code <= 0x064a) || (code >= 0x0660 && code <= 0x0669);
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isLatinAccented(code: number): boolean {
  return (
    (code >= 0xc0 && code <= 0xff && code !== 0xd7 && code !== 0xf7) ||
    code === 0x0152 ||
    code === 0x0153 ||
    code === 0x0160 ||
    code === 0x0161 ||
    code === 0x017d ||
    code === 0x017e ||
    code === 0x0178
  );
}

const WIN1252_COMMON_SYMBOLS = new Set([
  0x20ac, // €
  0x00a3, // £
  0x00a5, // ¥
  0x00a9, // ©
  0x00ae, // ®
  0x2122, // ™
  0x00b0, // °
  0x00d7, // ×
  0x00b7, // ·
  0x2013, // –
  0x2014, // —
  0x2018, // ‘
  0x2019, // ’
  0x201c, // “
  0x201d, // ”
  0x2022, // •
  0x2026, // …
]);

function detectBomlessUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const sampleLen = Math.min(bytes.length, 4096);
  if (sampleLen < 4) return null;
  let evenNulls = 0;
  let oddNulls = 0;
  const pairs = Math.floor(sampleLen / 2);
  for (let i = 0; i < pairs * 2; i += 2) {
    if (bytes[i] === 0) evenNulls++;
    if (bytes[i + 1] === 0) oddNulls++;
  }
  const evenRatio = evenNulls / pairs;
  const oddRatio = oddNulls / pairs;
  if (oddRatio >= 0.25 && evenRatio < 0.05) return 'utf-16le';
  if (evenRatio >= 0.25 && oddRatio < 0.05) return 'utf-16be';
  return null;
}

function scoreLegacyEncodings(bytes: Uint8Array): 'windows-1256' | 'windows-1252' {
  const sample = bytes.length > 65536 ? bytes.subarray(0, 65536) : bytes;
  const text1256 = new TextDecoder('windows-1256').decode(sample);
  const text1252 = new TextDecoder('windows-1252').decode(sample);

  let score1256 = 0;
  let score1252 = 0;

  for (let i = 0; i < text1256.length; i++) {
    const c = text1256.charCodeAt(i);
    if (isArabicLetter(c)) {
      score1256 += 1;
      if (i + 1 < text1256.length) {
        const next = text1256.charCodeAt(i + 1);
        if (isArabicLetter(next)) {
          score1256 += 3;
          // Arabic definite article "ال"
          if (c === 0x0627 && next === 0x0644) {
            score1256 += 5;
          }
        }
      }
    } else if (c === 0xfffd) {
      score1256 -= 4;
    }
  }

  let latinHighRun = 0;
  for (let i = 0; i < text1252.length; i++) {
    const c = text1252.charCodeAt(i);
    if (isLatinAccented(c)) {
      latinHighRun++;
      const prevAscii = i > 0 && isAsciiLetter(text1252.charCodeAt(i - 1));
      const nextAscii = i + 1 < text1252.length && isAsciiLetter(text1252.charCodeAt(i + 1));
      if (prevAscii || nextAscii) {
        score1252 += 3;
      } else {
        score1252 += 1;
      }
      if (latinHighRun >= 3) {
        // Real Western European text almost never has 3+ consecutive accented Latin letters;
        // Windows-1256 Arabic decoded as Windows-1252 produces long runs like "ÇáÞãíÕ".
        score1252 -= 4;
      }
    } else {
      latinHighRun = 0;
      if (WIN1252_COMMON_SYMBOLS.has(c)) {
        score1252 += 3;
      } else if (c === 0xfffd) {
        score1252 -= 4;
      }
    }
  }

  return score1256 > score1252 ? 'windows-1256' : 'windows-1252';
}

function hasDisallowedControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c <= 0x08 || (c >= 0x0e && c <= 0x1f) || (c >= 0x7f && c <= 0x9f)) && c !== 0x09) {
      return true;
    }
  }
  return false;
}

function containsValidUtf8MultiByteSequence(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 0xc2 && b <= 0xdf && i + 1 < bytes.length) {
      if ((bytes[i + 1] & 0xc0) === 0x80) return true;
    } else if (b >= 0xe0 && b <= 0xef && i + 2 < bytes.length) {
      if ((bytes[i + 1] & 0xc0) === 0x80 && (bytes[i + 2] & 0xc0) === 0x80) return true;
    } else if (b >= 0xf0 && b <= 0xf4 && i + 3 < bytes.length) {
      if (
        (bytes[i + 1] & 0xc0) === 0x80 &&
        (bytes[i + 2] & 0xc0) === 0x80 &&
        (bytes[i + 3] & 0xc0) === 0x80
      ) {
        return true;
      }
    }
  }
  return false;
}

function countMojibakeMarkers(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length - 1; i++) {
    const c = text.charCodeAt(i);
    const nextByte = charToWin1252Byte(text.charCodeAt(i + 1));
    if (nextByte === null || (nextByte & 0xc0) !== 0x80) continue;
    // Common UTF-8 lead bytes misread as Windows-1252:
    // 0xC2..0xC3 (Â/Ã for Latin), 0xD8..0xDB (Ø/Ù/Ú/Û for Arabic), 0xD0..0xD1 (Ð/Ñ for Cyrillic),
    // 0xE2 (â for punctuation/currency like â€™, â‚¬)
    if (
      c === 0x00c2 ||
      c === 0x00c3 ||
      (c >= 0x00d8 && c <= 0x00db) ||
      c === 0x00d0 ||
      c === 0x00d1 ||
      c === 0x00e2
    ) {
      count++;
    }
  }
  return count;
}

function repairSegmentOnce(segment: string): { text: string; changed: boolean } {
  const bytes = new Uint8Array(segment.length);
  for (let i = 0; i < segment.length; i++) {
    const b = charToWin1252Byte(segment.charCodeAt(i));
    if (b === null) return { text: segment, changed: false };
    bytes[i] = b;
  }

  if (!containsValidUtf8MultiByteSequence(bytes)) {
    return { text: segment, changed: false };
  }

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { text: segment, changed: false };
  }

  if (decoded === segment || hasDisallowedControlChars(decoded)) {
    return { text: segment, changed: false };
  }

  // Confirm the original segment genuinely looked like mojibake and the repair reduced markers
  // or produced target scripts (Arabic, common punctuation, etc.) cleanly.
  const beforeMarkers = countMojibakeMarkers(segment);
  const afterMarkers = countMojibakeMarkers(decoded);
  if (beforeMarkers === 0) {
    return { text: segment, changed: false };
  }
  if (afterMarkers >= beforeMarkers) {
    return { text: segment, changed: false };
  }

  return { text: decoded, changed: true };
}

/**
 * Deterministically repairs UTF-8 text that was previously mis-decoded as Windows-1252 / Latin-1
 * (e.g. Arabic "Ø§Ù„Ù‚Ù…ÙŠØµ" -> "القميص", Latin "cafÃ©" -> "café").
 * Processes Windows-1252-mappable segments independently so mixed strings stay safe.
 */
export function repairMojibake(input: string): MojibakeRepairResult {
  if (!input) return { text: input, changed: false };

  let current = input;
  let anyChanged = false;

  // Allow up to 2 passes for double-encoded mojibake, stopping immediately if no change.
  for (let pass = 0; pass < 2; pass++) {
    let passChanged = false;
    let out = '';
    let segStart = -1;

    for (let i = 0; i <= current.length; i++) {
      const mappable = i < current.length && charToWin1252Byte(current.charCodeAt(i)) !== null;
      if (mappable) {
        if (segStart === -1) segStart = i;
      } else {
        if (segStart !== -1) {
          const seg = current.slice(segStart, i);
          const repaired = repairSegmentOnce(seg);
          out += repaired.text;
          if (repaired.changed) passChanged = true;
          segStart = -1;
        }
        if (i < current.length) {
          out += current[i];
        }
      }
    }

    if (!passChanged) break;
    current = out;
    anyChanged = true;
  }

  return { text: current, changed: anyChanged };
}

export function hasMojibake(input: string): boolean {
  return repairMojibake(input).changed;
}

export function hasUnrecoverableQuestionMarks(input: string): boolean {
  return UNRECOVERABLE_QMARK_RE.test(input);
}

export function getEncodingLabel(encoding: DetectedEncoding): string {
  return ENCODING_LABELS[encoding];
}

export function detectEncodingAndDecode(bytes: Uint8Array): DecodeResult {
  if (bytes.length === 0) {
    return {
      text: '',
      encoding: 'utf-8',
      encodingLabel: ENCODING_LABELS['utf-8'],
      hasBom: false,
      mojibakeDetected: false,
      unrecoverableQuestionMarks: false,
    };
  }

  // 1. Check BOMs
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const body = bytes.subarray(3);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
      return buildDecodeResult(text, 'utf-8-bom', true);
    } catch {
      const fallback = scoreLegacyEncodings(body);
      const text = new TextDecoder(fallback).decode(body);
      return buildDecodeResult(text, fallback, true);
    }
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    const text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
    return buildDecodeResult(text, 'utf-16le', true);
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
    return buildDecodeResult(text, 'utf-16be', true);
  }

  // 2. Check BOM-less UTF-16
  const bomlessUtf16 = detectBomlessUtf16(bytes);
  if (bomlessUtf16) {
    const text = new TextDecoder(bomlessUtf16).decode(bytes);
    return buildDecodeResult(text, bomlessUtf16, false);
  }

  // 3. Try strict UTF-8
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return buildDecodeResult(text, 'utf-8', false);
  } catch {
    // 4. Score Windows-1256 (Arabic) vs Windows-1252 (Western European)
    const legacy = scoreLegacyEncodings(bytes);
    const text = new TextDecoder(legacy).decode(bytes);
    return buildDecodeResult(text, legacy, false);
  }
}

function buildDecodeResult(
  text: string,
  encoding: DetectedEncoding,
  hasBom: boolean,
): DecodeResult {
  // Sample up to 64 KB for quick file-level detection flags (per-cell rules check every cell).
  const sample = text.length > 65536 ? text.slice(0, 65536) : text;
  return {
    text,
    encoding,
    encodingLabel: ENCODING_LABELS[encoding],
    hasBom,
    mojibakeDetected: hasMojibake(sample),
    unrecoverableQuestionMarks: hasUnrecoverableQuestionMarks(sample),
  };
}
