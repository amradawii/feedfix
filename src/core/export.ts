import { ExportTarget } from './convert';
import { ChangeLogEntry } from './fixes';
import { CatalogModel } from './model';
import { ParsedCsv } from './parse';
import {
  GoogleExportOptions,
  writeGoogleCatalog,
  writeShopifyCatalog,
  writeWooCommerceCatalog,
} from './platforms';

export interface CsvSerializeOptions {
  delimiter?: ',' | '\t';
  includeBom?: boolean;
  lineEnding?: '\r\n' | '\n';
}

export interface ExportCatalogParams {
  parsed: ParsedCsv;
  catalog: CatalogModel;
  target: ExportTarget;
  includeBom?: boolean;
  googleOptions?: GoogleExportOptions;
}

export interface ExportResult {
  content: string;
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  rowCount: number;
  delimiter: ',' | '\t';
}

/**
 * RFC 4180 field escaping: wraps the cell in double quotes whenever it contains
 * the delimiter, a double quote, CR, or LF, doubling internal quotes.
 */
export function escapeCsvCell(value: string, delimiter: ',' | '\t' = ','): string {
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function serializeCsv(
  headers: string[],
  rows: string[][],
  options: CsvSerializeOptions = {},
): string {
  const delimiter = options.delimiter ?? ',';
  const lineEnding = options.lineEnding ?? '\r\n';
  const lines: string[] = [headers.map((h) => escapeCsvCell(h, delimiter)).join(delimiter)];

  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsvCell(cell ?? '', delimiter)).join(delimiter));
  }

  const body = lines.join(lineEnding) + lineEnding;
  return options.includeBom ? `\uFEFF${body}` : body;
}

export function serializeChangeLogCsv(changeLog: ChangeLogEntry[], includeBom = false): string {
  const headers = ['Row', 'Column', 'Before', 'After', 'Rule', 'Rule ID'];
  const rows = changeLog.map((entry) => [
    String(entry.row),
    entry.columnName,
    entry.before,
    entry.after,
    entry.ruleTitle,
    entry.ruleId,
  ]);
  return serializeCsv(headers, rows, { delimiter: ',', includeBom });
}

export function exportCatalog(
  params: ExportCatalogParams,
  baseFileName = 'products',
): ExportResult {
  const { parsed, catalog, target, includeBom = false, googleOptions } = params;
  const cleanBase = baseFileName.replace(/\.(csv|tsv|txt)$/i, '') || 'products';

  let headers: string[];
  let rows: string[][];
  let delimiter: ',' | '\t';
  let suffix: string;

  if (target === 'same') {
    // Preserve every original column and row order directly from the patched grid.
    headers = parsed.headers;
    rows = parsed.rows;
    delimiter = catalog.platform === 'google' && parsed.delimiter === '\t' ? '\t' : ',';
    suffix = 'cleaned';
  } else if (target === 'shopify') {
    const out = writeShopifyCatalog(catalog);
    headers = out.headers;
    rows = out.rows;
    delimiter = ',';
    suffix = 'shopify';
  } else if (target === 'woocommerce') {
    const out = writeWooCommerceCatalog(catalog);
    headers = out.headers;
    rows = out.rows;
    delimiter = ',';
    suffix = 'woocommerce';
  } else {
    const out = writeGoogleCatalog(catalog, googleOptions);
    headers = out.headers;
    rows = out.rows;
    delimiter = '\t';
    suffix = 'google-merchant';
  }

  const content = serializeCsv(headers, rows, { delimiter, includeBom });
  const bytes = new TextEncoder().encode(content);
  const ext = delimiter === '\t' ? 'tsv' : 'csv';
  const mimeType =
    delimiter === '\t' ? 'text/tab-separated-values;charset=utf-8' : 'text/csv;charset=utf-8';

  return {
    content,
    bytes,
    fileName: `${cleanBase}-${suffix}.${ext}`,
    mimeType,
    rowCount: rows.length,
    delimiter,
  };
}
