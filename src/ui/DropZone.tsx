import React, { useRef, useState } from 'react';
import { SAMPLE_FEEDS, SampleFeed } from '../samples';

interface DropZoneProps {
  isBusy: boolean;
  progressText: string | null;
  progressPercent: number;
  errorMessage: string | null;
  onFileSelected: (file: File) => void;
  onSampleSelected: (sample: SampleFeed) => void;
}

export function DropZone({
  isBusy,
  progressText,
  progressPercent,
  errorMessage,
  onFileSelected,
  onSampleSelected,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onFileSelected(files[0]);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (isBusy) return;
    handleFiles(event.dataTransfer.files);
  };

  return (
    <section aria-labelledby="upload-heading" className="space-y-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!isBusy) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={[
          'rounded-lg border border-dashed px-6 py-10 text-center transition-colors',
          isDragging ? 'border-accent bg-blue-50/40' : 'border-neutral-300 bg-white',
        ].join(' ')}
      >
        <h2 id="upload-heading" className="text-base font-semibold text-neutral-900">
          Drop a product CSV or TSV file here
        </h2>
        <p className="mt-1.5 text-sm text-neutral-600">
          Works with Shopify, WooCommerce, Google Merchant Center, or any CSV. Up to 100,000 rows or
          50 MB.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <input
            ref={inputRef}
            id="csv-file-input"
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            className="sr-only"
            disabled={isBusy}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            Choose file
          </button>
          <span className="text-xs text-neutral-500">
            Everything runs in your browser. Files never leave your device.
          </span>
        </div>

        <div className="mt-5" aria-live="polite" role="status">
          {isBusy && progressText && (
            <div className="mx-auto max-w-md space-y-2">
              <div className="flex justify-between text-xs text-neutral-600">
                <span>{progressText}</span>
                <span className="tabular-nums">{progressPercent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                <div
                  className="h-full bg-accent transition-all duration-150"
                  style={{ width: `${Math.min(100, Math.max(5, progressPercent))}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mx-auto mt-4 max-w-xl rounded-lg border border-red-200 bg-red-50/50 px-4 py-2.5 text-left text-sm text-red-700"
          >
            {errorMessage}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-neutral-200 p-4">
        <p className="text-sm font-medium text-neutral-800">Try a sample file</p>
        <p className="mt-0.5 text-xs text-neutral-500">
          Self-made files with fake products showing typical encoding, price, barcode and platform
          issues.
        </p>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
          {SAMPLE_FEEDS.map((sample) => (
            <button
              key={sample.id}
              type="button"
              disabled={isBusy}
              onClick={() => onSampleSelected(sample)}
              className="rounded-lg border border-neutral-200 px-3.5 py-2.5 text-left transition-colors hover:border-accent/60 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              <span className="block text-sm font-medium text-accent">{sample.name}</span>
              <span className="mt-0.5 block text-xs text-neutral-600">{sample.description}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
