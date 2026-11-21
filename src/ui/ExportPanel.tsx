import { useMemo, useState } from 'react';
import {
  analyzeConversion,
  ConversionNotice,
  detectUnambiguousCurrency,
  ExportTarget,
} from '../core/convert';
import { getPlatformLabel } from '../core/detect';
import { exportCatalog, ExportResult, serializeChangeLogCsv } from '../core/export';
import { ChangeLogEntry } from '../core/fixes';
import { CatalogModel } from '../core/model';
import { ParsedCsv } from '../core/parse';

export interface DownloadPayload {
  fileName: string;
  content: string;
  mimeType: string;
}

interface ExportPanelProps {
  fileName: string;
  parsed: ParsedCsv;
  catalog: CatalogModel;
  /** Original un-modified catalog used to detect unambiguous currency before price normalization */
  sourceCatalog?: CatalogModel;
  changeLog: ChangeLogEntry[];
  onDownloadFile?: (payload: DownloadPayload) => void;
}

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;

function triggerBrowserDownload(payload: DownloadPayload): void {
  const blob = new Blob([payload.content], { type: payload.mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = payload.fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hasArabicInParsed(parsed: ParsedCsv): boolean {
  for (const h of parsed.headers) {
    if (ARABIC_SCRIPT_RE.test(h)) return true;
  }
  const limit = Math.min(parsed.rows.length, 200);
  for (let r = 0; r < limit; r++) {
    for (const cell of parsed.rows[r]) {
      if (ARABIC_SCRIPT_RE.test(cell)) return true;
    }
  }
  return false;
}

const NOTICE_STYLES: Record<ConversionNotice['kind'], { dot: string; text: string }> = {
  missing: { dot: 'bg-amber-600', text: 'text-amber-800' },
  lost: { dot: 'bg-neutral-500', text: 'text-neutral-700' },
  note: { dot: 'bg-neutral-400', text: 'text-neutral-600' },
};

export function ExportPanel({
  fileName,
  parsed,
  catalog,
  sourceCatalog,
  changeLog,
  onDownloadFile,
}: ExportPanelProps) {
  const detectedCurrency = useMemo(
    () =>
      detectUnambiguousCurrency(catalog) ??
      (sourceCatalog ? detectUnambiguousCurrency(sourceCatalog) : null),
    [catalog, sourceCatalog],
  );
  const [target, setTarget] = useState<ExportTarget>('same');
  const [storeBaseUrl, setStoreBaseUrl] = useState('');
  const [currencyCode, setCurrencyCode] = useState(detectedCurrency ?? '');
  const [prevDetectedCurrency, setPrevDetectedCurrency] = useState(detectedCurrency);
  const [includeBom, setIncludeBom] = useState(() => hasArabicInParsed(parsed));
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (prevDetectedCurrency !== detectedCurrency) {
    setPrevDetectedCurrency(detectedCurrency);
    setCurrencyCode(detectedCurrency ?? '');
  }

  const report = useMemo(
    () =>
      analyzeConversion(catalog, target, {
        storeBaseUrl,
        currencyCode,
      }),
    [catalog, target, storeBaseUrl, currencyCode],
  );

  const deliver = onDownloadFile ?? triggerBrowserDownload;

  const handleExportCsv = () => {
    const result: ExportResult = exportCatalog(
      {
        parsed,
        catalog,
        target,
        includeBom,
        googleOptions: {
          storeBaseUrl,
          currencyCode,
        },
      },
      fileName,
    );
    deliver({
      fileName: result.fileName,
      content: result.content,
      mimeType: result.mimeType,
    });
    setStatusMessage(
      `Downloaded ${result.fileName} (${result.rowCount.toLocaleString(
        'en-US',
      )} rows, ${changeLog.length.toLocaleString('en-US')} changes applied).`,
    );
  };

  const handleExportChangeLog = () => {
    const cleanBase = fileName.replace(/\.(csv|tsv|txt)$/i, '') || 'products';
    const logName = `${cleanBase}-changelog.csv`;
    const content = serializeChangeLogCsv(changeLog, includeBom);
    deliver({
      fileName: logName,
      content,
      mimeType: 'text/csv;charset=utf-8',
    });
    setStatusMessage(
      `Downloaded ${logName} (${changeLog.length.toLocaleString('en-US')} recorded changes).`,
    );
  };

  const targetOptions: Array<{ id: ExportTarget; label: string; hint: string }> = [
    {
      id: 'same',
      label: 'Same format',
      hint: `Keep ${getPlatformLabel(catalog.platform)} columns intact`,
    },
    {
      id: 'shopify',
      label: 'Shopify',
      hint: '2023 Shopify product CSV (Handle, Product Category)',
    },
    {
      id: 'woocommerce',
      label: 'WooCommerce',
      hint: 'WooCommerce built-in product CSV importer',
    },
    {
      id: 'google',
      label: 'Google Merchant Center',
      hint: 'Tab-separated product feed with item_group_id',
    },
  ];

  return (
    <section aria-labelledby="export-heading" className="space-y-6">
      <div>
        <h2 id="export-heading" className="text-base font-semibold text-neutral-900">
          Export clean file
        </h2>
        <p className="mt-0.5 text-sm text-neutral-600 tabular-nums">
          {changeLog.length.toLocaleString('en-US')} {changeLog.length === 1 ? 'change' : 'changes'}{' '}
          applied to {parsed.rows.length.toLocaleString('en-US')} rows.
        </p>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Target format
        </p>
        <div
          role="radiogroup"
          aria-label="Export target format"
          className="mt-2 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
        >
          {targetOptions.map((opt) => {
            const active = target === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTarget(opt.id)}
                className={[
                  'rounded-lg border px-3.5 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40',
                  active
                    ? 'border-accent bg-blue-50/40'
                    : 'border-neutral-200 bg-white hover:border-neutral-300',
                ].join(' ')}
              >
                <span
                  className={[
                    'block text-sm font-medium',
                    active ? 'text-accent' : 'text-neutral-900',
                  ].join(' ')}
                >
                  {opt.label}
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">{opt.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {target === 'google' && (
        <div className="grid gap-4 rounded-lg border border-neutral-200 p-4 sm:grid-cols-2">
          <div>
            <label htmlFor="google-base-url" className="block text-xs font-medium text-neutral-800">
              Store base URL (optional)
            </label>
            <input
              id="google-base-url"
              type="url"
              value={storeBaseUrl}
              disabled={!report.canDeriveGoogleLinks}
              onChange={(e) => setStoreBaseUrl(e.target.value)}
              placeholder="https://yourstore.com"
              className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 font-mono text-xs text-neutral-900 placeholder:text-neutral-400 disabled:bg-neutral-50 disabled:text-neutral-500 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            <p className="mt-1 text-xs text-neutral-500">
              {report.canDeriveGoogleLinks
                ? 'Builds exact Shopify product links as <base>/products/<handle>. Leave blank to omit.'
                : 'WooCommerce and generic CSVs have no product permalink; link stays blank instead of guessing.'}
            </p>
          </div>

          <div>
            <label htmlFor="google-currency" className="block text-xs font-medium text-neutral-800">
              Currency code (optional)
            </label>
            <input
              id="google-currency"
              type="text"
              maxLength={3}
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
              placeholder="USD, EGP, EUR…"
              className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 font-mono text-xs uppercase text-neutral-900 placeholder:text-neutral-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            <p className="mt-1 text-xs text-neutral-500">
              {detectedCurrency
                ? `Pre-filled from currency found in your file (${detectedCurrency}). You can edit or clear it.`
                : '3-letter ISO code added to Google prices (e.g. 15.00 USD). Never guessed if blank.'}
            </p>
          </div>
        </div>
      )}

      {report.notices.length > 0 && (
        <div className="rounded-lg border border-neutral-200 p-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            {target === 'same' ? 'Export notes' : 'What will be lost or needs attention'}
          </h3>
          <ul className="mt-2.5 space-y-2 text-sm">
            {report.notices.map((notice, idx) => {
              const style = NOTICE_STYLES[notice.kind];
              return (
                <li
                  key={`${notice.field}-${idx}`}
                  className={`flex items-baseline gap-2 ${style.text}`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`}
                    aria-hidden="true"
                  />
                  <span>{notice.message}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-neutral-200 pt-4">
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={includeBom}
            onChange={(e) => setIncludeBom(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300 text-accent focus:ring-accent/40"
          />
          <span>Add UTF-8 BOM (helps Excel open Arabic text cleanly)</span>
        </label>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportChangeLog}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            Download change log CSV ({changeLog.length.toLocaleString('en-US')})
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            {target === 'google' ? 'Download Google TSV' : 'Download clean CSV'}
          </button>
        </div>
      </div>

      <div aria-live="polite" role="status" className="min-h-[1.25rem] text-xs text-neutral-600">
        {statusMessage}
      </div>
    </section>
  );
}
