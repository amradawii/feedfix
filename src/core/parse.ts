import Papa from 'papaparse';
import { DetectedEncoding, detectEncodingAndDecode } from './encoding';

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_DATA_ROWS = 100_000;

export type DetectedDelimiter = ',' | ';' | '\t' | '|';

export interface DelimiterInfo {
  delimiter: DetectedDelimiter;
  label: 'comma' | 'semicolon' | 'tab' | 'pipe';
}

export interface RaggedRowInfo {
  /** 1-based spreadsheet row number (header = 1, first data row = 2) */
  row: number;
  expected: number;
  actual: number;
}

export interface CsvParseIssue {
  row: number;
  code: string;
  message: string;
}

export interface ParsedCsv {
  headers: string[];
  /** Data rows (0-indexed; index i corresponds to spreadsheet row i + 2) */
  rows: string[][];
  encoding: DetectedEncoding;
  encodingLabel: string;
  hasBom: boolean;
  delimiter: DetectedDelimiter;
  delimiterLabel: DelimiterInfo['label'];
  byteLength: number;
  raggedRows: RaggedRowInfo[];
  parseIssues: CsvParseIssue[];
  mojibakeDetected: boolean;
  unrecoverableQuestionMarks: boolean;
}

export interface ParseProgress {
  stage: 'decoding' | 'parsing';
  percent: number;
  rowsParsed?: number;
}

export interface ParseOptions {
  delimiter?: DetectedDelimiter;
  onProgress?: (progress: ParseProgress) => void;
}

export class CsvLimitError extends Error {
  readonly code: 'LIMIT_EXCEEDED' | 'EMPTY_FILE';

  constructor(code: 'LIMIT_EXCEEDED' | 'EMPTY_FILE', message: string) {
    super(message);
    this.name = 'CsvLimitError';
    this.code = code;
  }
}

const DELIMITER_CANDIDATES: DelimiterInfo[] = [
  { delimiter: ',', label: 'comma' },
  { delimiter: ';', label: 'semicolon' },
  { delimiter: '\t', label: 'tab' },
  { delimiter: '|', label: 'pipe' },
];

export function getDelimiterLabel(delimiter: DetectedDelimiter): DelimiterInfo['label'] {
  const found = DELIMITER_CANDIDATES.find((c) => c.delimiter === delimiter);
  return found ? found.label : 'comma';
}

/**
 * Splits up to `maxRecords` logical CSV records while respecting double-quoted fields,
 * so embedded newlines inside quoted cells do not split a record during delimiter detection.
 */
function extractSampleLogicalRecords(text: string, maxRecords = 30): string[] {
  const records: string[] = [];
  let inQuotes = false;
  let start = 0;
  const maxChars = Math.min(text.length, 262_144);

  for (let i = 0; i < maxChars && records.length < maxRecords; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < maxChars && text[i + 1] === '"') {
        i++; // escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      const rec = text.slice(start, i);
      if (rec.trim().length > 0) {
        records.push(rec);
      }
      if (ch === '\r' && i + 1 < maxChars && text[i + 1] === '\n') {
        i++;
      }
      start = i + 1;
    }
  }

  if (records.length < maxRecords && start < maxChars) {
    const tail = text.slice(start, maxChars);
    if (tail.trim().length > 0) {
      records.push(tail);
    }
  }

  return records;
}

function countDelimiterOutsideQuotes(record: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (let i = 0; i < record.length; i++) {
    const ch = record[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < record.length && record[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && ch === delimiter) {
      count++;
    }
  }
  return count;
}

export function detectDelimiter(text: string): DelimiterInfo {
  const records = extractSampleLogicalRecords(text, 30);
  if (records.length === 0) {
    return DELIMITER_CANDIDATES[0];
  }

  let best = DELIMITER_CANDIDATES[0];
  let bestScore = -1;

  for (const candidate of DELIMITER_CANDIDATES) {
    const counts = records.map((rec) => countDelimiterOutsideQuotes(rec, candidate.delimiter));
    const headerCount = counts[0];
    if (headerCount === 0) continue;

    if (counts.length === 1) {
      const score = headerCount * 10;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
      continue;
    }

    let exactMatches = 0;
    let totalDiff = 0;
    for (let i = 1; i < counts.length; i++) {
      const diff = Math.abs(counts[i] - headerCount);
      if (diff === 0) exactMatches++;
      totalDiff += diff;
    }

    const dataRows = counts.length - 1;
    const consistency = exactMatches / dataRows;
    const avgDiff = totalDiff / dataRows;
    // Reward high consistency across rows and having multiple columns; penalize column drift.
    const score = consistency * 1000 + Math.min(headerCount, 50) * 5 - avgDiff * 40;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

export function parseCsvBytes(bytes: Uint8Array, options: ParseOptions = {}): ParsedCsv {
  if (bytes.byteLength === 0) {
    throw new CsvLimitError('EMPTY_FILE', 'This file is empty.');
  }

  if (bytes.byteLength > MAX_FILE_BYTES) {
    const mb = (bytes.byteLength / (1024 * 1024)).toFixed(1);
    throw new CsvLimitError(
      'LIMIT_EXCEEDED',
      `This file is ${mb} MB. FeedFix supports files up to 50 MB.`,
    );
  }

  options.onProgress?.({ stage: 'decoding', percent: 5 });
  const decoded = detectEncodingAndDecode(bytes);

  if (decoded.text.trim().length === 0) {
    throw new CsvLimitError('EMPTY_FILE', 'This file has no text or rows to check.');
  }

  const delimiterInfo: DelimiterInfo = options.delimiter
    ? { delimiter: options.delimiter, label: getDelimiterLabel(options.delimiter) }
    : detectDelimiter(decoded.text);

  options.onProgress?.({ stage: 'parsing', percent: 15, rowsParsed: 0 });

  let headers: string[] | null = null;
  const rows: string[][] = [];
  const raggedRows: RaggedRowInfo[] = [];
  const parseIssues: CsvParseIssue[] = [];
  let exceededRowLimit = false;
  let recordIndex = 0;

  // Estimate progress by tracking parsed characters vs total length.
  const totalChars = decoded.text.length || 1;

  Papa.parse<string[]>(decoded.text, {
    delimiter: delimiterInfo.delimiter,
    header: false,
    skipEmptyLines: false,
    step: (result, parser) => {
      const cells = Array.isArray(result.data) ? result.data.map((cell) => String(cell ?? '')) : [];

      if (headers === null) {
        headers = cells;
        recordIndex = 1;
        if (result.errors.length > 0) {
          for (const err of result.errors) {
            parseIssues.push({
              row: 1,
              code: err.code,
              message: err.message,
            });
          }
        }
        return;
      }

      recordIndex++;
      if (rows.length >= MAX_DATA_ROWS) {
        // Ignore a single trailing blank line after row 100,000.
        if (cells.length === 1 && cells[0] === '') {
          return;
        }
        exceededRowLimit = true;
        parser.abort();
        return;
      }

      rows.push(cells);

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          parseIssues.push({
            row: recordIndex,
            code: err.code,
            message: err.message,
          });
        }
      }

      if (rows.length % 2000 === 0 && options.onProgress) {
        const cursor = result.meta.cursor ?? 0;
        const pct = Math.min(95, 15 + Math.round((cursor / totalChars) * 80));
        options.onProgress({ stage: 'parsing', percent: pct, rowsParsed: rows.length });
      }
    },
  });

  if (exceededRowLimit) {
    throw new CsvLimitError(
      'LIMIT_EXCEEDED',
      `This file has more than ${MAX_DATA_ROWS.toLocaleString(
        'en-US',
      )} rows. Split it into smaller files to check it in your browser.`,
    );
  }

  const finalHeaders = headers ?? [];

  // Trim trailing completely empty lines created by a final newline at EOF.
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') {
      rows.pop();
    } else {
      break;
    }
  }

  // Record ragged rows (excluding trimmed EOF lines).
  const expectedCols = finalHeaders.length;
  for (let i = 0; i < rows.length; i++) {
    const actual = rows[i].length;
    if (actual !== expectedCols) {
      raggedRows.push({
        row: i + 2,
        expected: expectedCols,
        actual,
      });
    }
  }

  options.onProgress?.({ stage: 'parsing', percent: 100, rowsParsed: rows.length });

  return {
    headers: finalHeaders,
    rows,
    encoding: decoded.encoding,
    encodingLabel: decoded.encodingLabel,
    hasBom: decoded.hasBom,
    delimiter: delimiterInfo.delimiter,
    delimiterLabel: delimiterInfo.label,
    byteLength: bytes.byteLength,
    raggedRows,
    parseIssues,
    mojibakeDetected: decoded.mojibakeDetected,
    unrecoverableQuestionMarks: decoded.unrecoverableQuestionMarks,
  };
}
