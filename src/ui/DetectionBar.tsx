import { getPlatformLabel } from '../core/detect';
import { Platform } from '../core/model';
import { DetectedDelimiter } from '../core/parse';

interface DetectionBarProps {
  fileName: string;
  platform: Platform;
  rowCount: number;
  productCount: number;
  encodingLabel: string;
  delimiter: DetectedDelimiter;
  delimiterLabel: string;
  isBusy: boolean;
  onPlatformChange: (platform: Platform) => void;
  onDelimiterChange: (delimiter: DetectedDelimiter) => void;
  onReset: () => void;
}

const PLATFORM_OPTIONS: Array<{ value: Platform; label: string }> = [
  { value: 'shopify', label: 'Shopify product CSV' },
  { value: 'woocommerce', label: 'WooCommerce product CSV' },
  { value: 'google', label: 'Google Merchant Center feed' },
  { value: 'other', label: 'Other CSV (manual mapping)' },
];

const DELIMITER_OPTIONS: Array<{ value: DetectedDelimiter; label: string }> = [
  { value: ',', label: 'comma' },
  { value: ';', label: 'semicolon' },
  { value: '\t', label: 'tab' },
  { value: '|', label: 'pipe' },
];

export function DetectionBar({
  fileName,
  platform,
  rowCount,
  productCount,
  encodingLabel,
  delimiter,
  delimiterLabel,
  isBusy,
  onPlatformChange,
  onDelimiterChange,
  onReset,
}: DetectionBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50/60 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium text-neutral-900">
          <span>{getPlatformLabel(platform)}</span>
          <span className="mx-1.5 text-neutral-300" aria-hidden="true">
            &middot;
          </span>
          <span className="tabular-nums">{rowCount.toLocaleString('en-US')} rows</span>
          <span className="mx-1.5 text-neutral-300" aria-hidden="true">
            &middot;
          </span>
          <span className="tabular-nums">{productCount.toLocaleString('en-US')} products</span>
          <span className="mx-1.5 text-neutral-300" aria-hidden="true">
            &middot;
          </span>
          <span>{encodingLabel}</span>
          <span className="mx-1.5 text-neutral-300" aria-hidden="true">
            &middot;
          </span>
          <span>{delimiterLabel}</span>
        </p>
        <p className="mt-0.5 truncate font-mono text-xs text-neutral-500">{fileName}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
          <span>Format</span>
          <select
            aria-label="Detected platform format"
            disabled={isBusy}
            value={platform}
            onChange={(e) => onPlatformChange(e.target.value as Platform)}
            className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            {PLATFORM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
          <span>Delimiter</span>
          <select
            aria-label="Detected delimiter"
            disabled={isBusy}
            value={delimiter}
            onChange={(e) => onDelimiterChange(e.target.value as DetectedDelimiter)}
            className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            {DELIMITER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={onReset}
          className="text-xs font-medium text-accent hover:text-accent-hover focus:outline-none focus:underline"
        >
          Change file
        </button>
      </div>
    </div>
  );
}
