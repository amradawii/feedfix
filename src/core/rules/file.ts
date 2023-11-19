import { hasUnrecoverableQuestionMarks, repairMojibake } from '../encoding';
import { normalizeHeader } from '../model';
import { ALL_PLATFORMS, createProblemId, Problem, RuleRunner } from './types';

const STRIP_INVISIBLE_CODES = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

function hasInvisibleChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x00a0 || STRIP_INVISIBLE_CODES.has(code)) {
      return true;
    }
  }
  return false;
}

function cleanInvisibleChars(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (STRIP_INVISIBLE_CODES.has(code)) continue;
    out += code === 0x00a0 ? ' ' : value[i];
  }
  return out;
}

function truncatePreview(value: string, maxLen = 40): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > maxLen ? `${singleLine.slice(0, maxLen)}…` : singleLine;
}

export const fileEncodingRule: RuleRunner = {
  meta: {
    id: 'file.encoding-converted',
    group: 'file',
    severity: 'tip',
    platforms: ALL_PLATFORMS,
    title: 'File was not saved as UTF-8',
    explanation:
      'FeedFix decoded the file from its original encoding so export will be clean UTF-8.',
    hasSafeFix: false,
  },
  run: ({ parsed }) => {
    if (parsed.encoding === 'utf-8' || parsed.encoding === 'utf-8-bom') {
      return [];
    }
    return [
      {
        id: createProblemId('file.encoding-converted', 1),
        ruleId: 'file.encoding-converted',
        group: 'file',
        severity: 'tip',
        title: 'File was not saved as UTF-8',
        message: `Detected ${parsed.encodingLabel}. FeedFix decoded it cleanly and will export UTF-8.`,
        row: 1,
        rawValue: parsed.encodingLabel,
      },
    ];
  },
};

export const fileMojibakeRule: RuleRunner = {
  meta: {
    id: 'file.mojibake',
    group: 'file',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Broken text encoding (mojibake)',
    explanation:
      'UTF-8 text was previously saved with the wrong encoding and can be repaired cleanly.',
    hasSafeFix: true,
  },
  run: ({ parsed }) => {
    const problems: Problem[] = [];
    const { headers, rows } = parsed;

    for (let c = 0; c < headers.length; c++) {
      const raw = headers[c];
      const repaired = repairMojibake(raw);
      if (repaired.changed) {
        problems.push({
          id: createProblemId('file.mojibake', 1, c),
          ruleId: 'file.mojibake',
          group: 'file',
          severity: 'fail',
          title: 'Broken text encoding (mojibake)',
          message: `Broken text in header "${truncatePreview(raw)}" repairs to "${truncatePreview(
            repaired.text,
          )}".`,
          row: 1,
          col: c,
          columnName: raw,
          rawValue: raw,
          fix: {
            safe: true,
            description: 'Repair mis-decoded UTF-8 text',
            edits: [{ row: 1, col: c, columnName: raw, before: raw, after: repaired.text }],
          },
        });
      }
    }

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const rowNum = r + 2;
      for (let c = 0; c < row.length; c++) {
        const raw = row[c];
        if (!raw) continue;
        const repaired = repairMojibake(raw);
        if (repaired.changed) {
          const colName = headers[c] ?? `Column ${c + 1}`;
          problems.push({
            id: createProblemId('file.mojibake', rowNum, c),
            ruleId: 'file.mojibake',
            group: 'file',
            severity: 'fail',
            title: 'Broken text encoding (mojibake)',
            message: `Broken text "${truncatePreview(raw)}" repairs to "${truncatePreview(
              repaired.text,
            )}".`,
            row: rowNum,
            col: c,
            columnName: colName,
            rawValue: raw,
            fix: {
              safe: true,
              description: 'Repair mis-decoded UTF-8 text',
              edits: [
                { row: rowNum, col: c, columnName: colName, before: raw, after: repaired.text },
              ],
            },
          });
        }
      }
    }

    return problems;
  },
};

export const fileUnrecoverableQuestionMarksRule: RuleRunner = {
  meta: {
    id: 'file.unrecoverable-question-marks',
    group: 'file',
    severity: 'reject',
    platforms: ALL_PLATFORMS,
    title: 'Text lost to "???" characters (unrecoverable)',
    explanation:
      'Original characters were replaced with question marks when saved in an incompatible encoding and cannot be restored.',
    hasSafeFix: false,
  },
  run: ({ parsed }) => {
    const problems: Problem[] = [];
    const { headers, rows } = parsed;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const rowNum = r + 2;
      for (let c = 0; c < row.length; c++) {
        const raw = row[c];
        if (!raw) continue;
        if (hasUnrecoverableQuestionMarks(raw)) {
          const colName = headers[c] ?? `Column ${c + 1}`;
          problems.push({
            id: createProblemId('file.unrecoverable-question-marks', rowNum, c),
            ruleId: 'file.unrecoverable-question-marks',
            group: 'file',
            severity: 'reject',
            title: 'Text lost to "???" characters (unrecoverable)',
            message: `Text "${truncatePreview(
              raw,
            )}" contains unrecoverable "???" or replacement characters from an earlier save.`,
            row: rowNum,
            col: c,
            columnName: colName,
            rawValue: raw,
          });
        }
      }
    }

    return problems;
  },
};

export const fileDelimiterRule: RuleRunner = {
  meta: {
    id: 'file.non-comma-delimiter',
    group: 'file',
    severity: 'tip',
    platforms: ALL_PLATFORMS,
    title: 'File uses a non-comma delimiter',
    explanation:
      'Shopify and WooCommerce expect comma-separated columns by default; FeedFix detected this delimiter automatically.',
    hasSafeFix: false,
  },
  run: ({ parsed, catalog }) => {
    if (parsed.delimiter === ',') return [];
    // Tab-delimited feeds are standard for Google Merchant Center
    if (catalog.platform === 'google' && parsed.delimiter === '\t') {
      return [];
    }
    return [
      {
        id: createProblemId('file.non-comma-delimiter', 1),
        ruleId: 'file.non-comma-delimiter',
        group: 'file',
        severity: 'tip',
        title: 'File uses a non-comma delimiter',
        message: `Columns are separated by ${parsed.delimiterLabel} instead of comma. Export will use the platform's standard delimiter.`,
        row: 1,
        rawValue: parsed.delimiterLabel,
      },
    ];
  },
};

export const fileDuplicateHeaderRule: RuleRunner = {
  meta: {
    id: 'file.duplicate-header',
    group: 'file',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Duplicate column header',
    explanation:
      'Two or more columns share the same header name, which can overwrite data on import.',
    hasSafeFix: false,
  },
  run: ({ parsed }) => {
    const problems: Problem[] = [];
    const seen = new Map<string, number[]>();

    for (let c = 0; c < parsed.headers.length; c++) {
      const norm = normalizeHeader(parsed.headers[c]);
      if (!norm) continue;
      const list = seen.get(norm) ?? [];
      list.push(c);
      seen.set(norm, list);
    }

    for (const cols of seen.values()) {
      if (cols.length <= 1) continue;
      const colNumbers = cols.map((c) => c + 1).join(', ');
      for (const col of cols.slice(1)) {
        const name = parsed.headers[col];
        problems.push({
          id: createProblemId('file.duplicate-header', 1, col),
          ruleId: 'file.duplicate-header',
          group: 'file',
          severity: 'fail',
          title: 'Duplicate column header',
          message: `Column "${name}" appears more than once (columns ${colNumbers}).`,
          row: 1,
          col,
          columnName: name,
          rawValue: name,
        });
      }
    }

    return problems;
  },
};

export const fileEmptyHeaderRule: RuleRunner = {
  meta: {
    id: 'file.empty-header',
    group: 'file',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Empty column header',
    explanation: 'A column has no name in row 1, so platforms cannot map its values.',
    hasSafeFix: false,
  },
  run: ({ parsed }) => {
    const problems: Problem[] = [];
    for (let c = 0; c < parsed.headers.length; c++) {
      if (normalizeHeader(parsed.headers[c]) === '') {
        problems.push({
          id: createProblemId('file.empty-header', 1, c),
          ruleId: 'file.empty-header',
          group: 'file',
          severity: 'fail',
          title: 'Empty column header',
          message: `Column ${c + 1} has a blank header name.`,
          row: 1,
          col: c,
          columnName: `Column ${c + 1}`,
          rawValue: parsed.headers[c],
        });
      }
    }
    return problems;
  },
};

export const fileRaggedRowRule: RuleRunner = {
  meta: {
    id: 'file.ragged-row',
    group: 'file',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Row has the wrong number of columns',
    explanation:
      'A row has fewer or more cells than the header row, which shifts values into the wrong fields.',
    hasSafeFix: false,
  },
  run: ({ parsed }) => {
    return parsed.raggedRows.map((rr) => ({
      id: createProblemId('file.ragged-row', rr.row),
      ruleId: 'file.ragged-row',
      group: 'file',
      severity: 'fail',
      title: 'Row has the wrong number of columns',
      message: `Row ${rr.row} has ${rr.actual} columns instead of ${rr.expected}.`,
      row: rr.row,
      rawValue: `${rr.actual} of ${rr.expected}`,
    }));
  },
};

export const fileInvisibleCharsRule: RuleRunner = {
  meta: {
    id: 'file.invisible-chars',
    group: 'file',
    severity: 'tip',
    platforms: ALL_PLATFORMS,
    title: 'Hidden invisible characters in cell',
    explanation:
      'Zero-width spaces, non-breaking spaces, or stray BOM characters can break matching and imports.',
    hasSafeFix: true,
  },
  run: ({ parsed }) => {
    const problems: Problem[] = [];
    const { headers, rows } = parsed;

    for (let c = 0; c < headers.length; c++) {
      const raw = headers[c];
      if (!hasInvisibleChars(raw)) continue;
      const cleaned = cleanInvisibleChars(raw);
      if (cleaned !== raw) {
        problems.push({
          id: createProblemId('file.invisible-chars', 1, c),
          ruleId: 'file.invisible-chars',
          group: 'file',
          severity: 'tip',
          title: 'Hidden invisible characters in cell',
          message: `Header "${cleaned}" contains invisible characters or non-breaking spaces.`,
          row: 1,
          col: c,
          columnName: raw,
          rawValue: raw,
          fix: {
            safe: true,
            description: 'Remove invisible characters and replace non-breaking spaces',
            edits: [{ row: 1, col: c, columnName: raw, before: raw, after: cleaned }],
          },
        });
      }
    }

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const rowNum = r + 2;
      for (let c = 0; c < row.length; c++) {
        const raw = row[c];
        if (!raw || !hasInvisibleChars(raw)) continue;
        const cleaned = cleanInvisibleChars(raw);
        if (cleaned !== raw) {
          const colName = headers[c] ?? `Column ${c + 1}`;
          problems.push({
            id: createProblemId('file.invisible-chars', rowNum, c),
            ruleId: 'file.invisible-chars',
            group: 'file',
            severity: 'tip',
            title: 'Hidden invisible characters in cell',
            message: `Cell in "${colName}" contains invisible characters or non-breaking spaces.`,
            row: rowNum,
            col: c,
            columnName: colName,
            rawValue: raw,
            fix: {
              safe: true,
              description: 'Remove invisible characters and replace non-breaking spaces',
              edits: [{ row: rowNum, col: c, columnName: colName, before: raw, after: cleaned }],
            },
          });
        }
      }
    }

    return problems;
  },
};

export const FILE_RULES: RuleRunner[] = [
  fileEncodingRule,
  fileMojibakeRule,
  fileUnrecoverableQuestionMarksRule,
  fileDelimiterRule,
  fileDuplicateHeaderRule,
  fileEmptyHeaderRule,
  fileRaggedRowRule,
  fileInvisibleCharsRule,
];
