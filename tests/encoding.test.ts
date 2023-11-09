import { describe, expect, it } from 'vitest';
import {
  detectEncodingAndDecode,
  hasMojibake,
  hasUnrecoverableQuestionMarks,
  repairMojibake,
} from '../src/core/encoding';

function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function encodeUtf16Le(str: string, withBom = true): Uint8Array {
  const offset = withBom ? 2 : 0;
  const out = new Uint8Array(offset + str.length * 2);
  if (withBom) {
    out[0] = 0xff;
    out[1] = 0xfe;
  }
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    out[offset + i * 2] = code & 0xff;
    out[offset + i * 2 + 1] = code >> 8;
  }
  return out;
}

function encodeUtf16Be(str: string, withBom = true): Uint8Array {
  const offset = withBom ? 2 : 0;
  const out = new Uint8Array(offset + str.length * 2);
  if (withBom) {
    out[0] = 0xfe;
    out[1] = 0xff;
  }
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    out[offset + i * 2] = code >> 8;
    out[offset + i * 2 + 1] = code & 0xff;
  }
  return out;
}

// Helper: encode a Windows-1256 byte array for specific Arabic text used in tests.
// "القميص القطني" = ا(C7) ل(E1) ق(DE) م(E3) ي(ED) ص(D5) ' '(20) ا(C7) ل(E1) ق(DE) ط(D8) ن(E4) ي(ED)
function makeWin1256ArabicCsv(): Uint8Array {
  const header = encodeUtf8('Handle,Title,Variant Price\nshirt-1,');
  const arabicBytes = new Uint8Array([
    0xc7, 0xe1, 0xde, 0xe3, 0xed, 0xd5, 0x20, 0xc7, 0xe1, 0xde, 0xd8, 0xe4, 0xed,
  ]);
  const tail = encodeUtf8(',250.00\n');
  const combined = new Uint8Array(header.length + arabicBytes.length + tail.length);
  combined.set(header, 0);
  combined.set(arabicBytes, header.length);
  combined.set(tail, header.length + arabicBytes.length);
  return combined;
}

describe('encoding detection and decoding', () => {
  it('decodes UTF-8 without BOM', () => {
    const bytes = encodeUtf8('Handle,Title\nshirt-1,القميص القطني');
    const result = detectEncodingAndDecode(bytes);
    expect(result.encoding).toBe('utf-8');
    expect(result.hasBom).toBe(false);
    expect(result.text).toBe('Handle,Title\nshirt-1,القميص القطني');
    expect(result.mojibakeDetected).toBe(false);
  });

  it('decodes UTF-8 with BOM and strips BOM from text', () => {
    const body = encodeUtf8('Handle,Title\nshirt-1,Cotton Shirt');
    const withBom = new Uint8Array(3 + body.length);
    withBom.set([0xef, 0xbb, 0xbf], 0);
    withBom.set(body, 3);

    const result = detectEncodingAndDecode(withBom);
    expect(result.encoding).toBe('utf-8-bom');
    expect(result.hasBom).toBe(true);
    expect(result.text.startsWith('Handle,Title')).toBe(true);
  });

  it('decodes UTF-16 LE and UTF-16 BE with BOM', () => {
    const content = 'Handle,Title\nshirt-1,قميص قطن';
    const le = detectEncodingAndDecode(encodeUtf16Le(content, true));
    expect(le.encoding).toBe('utf-16le');
    expect(le.hasBom).toBe(true);
    expect(le.text).toBe(content);

    const be = detectEncodingAndDecode(encodeUtf16Be(content, true));
    expect(be.encoding).toBe('utf-16be');
    expect(be.hasBom).toBe(true);
    expect(be.text).toBe(content);
  });

  it('detects and decodes Windows-1256 Arabic bytes', () => {
    const result = detectEncodingAndDecode(makeWin1256ArabicCsv());
    expect(result.encoding).toBe('windows-1256');
    expect(result.text).toContain('القميص القطني');
  });

  it('detects and decodes Windows-1252 European bytes', () => {
    // "Handle,Title,Price\ncafe-1,Café Crème — 19,99 €\n"
    const prefix = encodeUtf8('Handle,Title,Price\ncafe-1,Caf');
    const mid = new Uint8Array([0xe9, 0x20, 0x43, 0x72, 0xe8, 0x6d, 0x65, 0x20, 0x97, 0x20]);
    const suffix = encodeUtf8('19,99 ');
    const euro = new Uint8Array([0x80, 0x0a]);
    const bytes = new Uint8Array(prefix.length + mid.length + suffix.length + euro.length);
    bytes.set(prefix, 0);
    bytes.set(mid, prefix.length);
    bytes.set(suffix, prefix.length + mid.length);
    bytes.set(euro, prefix.length + mid.length + suffix.length);

    const result = detectEncodingAndDecode(bytes);
    expect(result.encoding).toBe('windows-1252');
    expect(result.text).toContain('Café Crème — 19,99 €');
  });

  it('repairs Arabic and Latin UTF-8-as-Windows-1252 mojibake deterministically', () => {
    // Simulate Excel opening UTF-8 Arabic as Windows-1252 and saving back as UTF-8
    const originalArabic = 'القميص القطني';
    const utf8Bytes = encodeUtf8(originalArabic);
    const mojibake = new TextDecoder('windows-1252').decode(utf8Bytes);
    expect(mojibake.startsWith('Ø§Ù„')).toBe(true);

    expect(hasMojibake(mojibake)).toBe(true);
    const repaired = repairMojibake(mojibake);
    expect(repaired.changed).toBe(true);
    expect(repaired.text).toBe(originalArabic);

    // Also Latin mojibake
    const latinMojibake = new TextDecoder('windows-1252').decode(encodeUtf8('Café Crème'));
    expect(repairMojibake(latinMojibake)).toEqual({ text: 'Café Crème', changed: true });

    // Clean text must not be altered
    expect(repairMojibake('Cotton Shirt — Café 19.99 €')).toEqual({
      text: 'Cotton Shirt — Café 19.99 €',
      changed: false,
    });
    expect(repairMojibake('القميص القطني')).toEqual({
      text: 'القميص القطني',
      changed: false,
    });
  });

  it('flags unrecoverable question-mark corruption without confusing normal questions', () => {
    expect(hasUnrecoverableQuestionMarks('?????? ??????')).toBe(true);
    expect(hasUnrecoverableQuestionMarks('Shirt \uFFFD Blue')).toBe(true);
    expect(hasUnrecoverableQuestionMarks('Is featured?')).toBe(false);
    expect(hasUnrecoverableQuestionMarks('In stock?')).toBe(false);
  });
});
