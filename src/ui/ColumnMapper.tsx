import { useState } from 'react';
import { FieldMapping } from '../core/platforms';
import {
  deleteMappingPreset,
  loadMappingPresets,
  MappingPreset,
  MODEL_FIELDS,
  ModelFieldKey,
  resolvePresetToMapping,
  saveMappingPreset,
  suggestColumnMapping,
} from '../core/presets';

interface ColumnMapperProps {
  headers: string[];
  sampleRow: string[];
  mapping: FieldMapping;
  isBusy: boolean;
  onApplyMapping: (mapping: FieldMapping) => void;
}

export function ColumnMapper({
  headers,
  sampleRow,
  mapping,
  isBusy,
  onApplyMapping,
}: ColumnMapperProps) {
  const [draft, setDraft] = useState<FieldMapping>(mapping);
  const [prevMapping, setPrevMapping] = useState<FieldMapping>(mapping);
  const [presets, setPresets] = useState<MappingPreset[]>(() => loadMappingPresets());
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);

  if (prevMapping !== mapping) {
    setPrevMapping(mapping);
    setDraft(mapping);
  }

  const mappedCount = Object.values(draft).filter((v) => v !== undefined).length;

  const handleFieldChange = (key: ModelFieldKey, rawValue: string) => {
    setDraft((prev) => {
      const next = { ...prev };
      if (rawValue === '') {
        delete next[key];
      } else {
        next[key] = Number(rawValue);
      }
      return next;
    });
  };

  const handleLoadPreset = (id: string) => {
    setSelectedPresetId(id);
    const found = presets.find((p) => p.id === id);
    if (!found) return;
    const resolved = resolvePresetToMapping(found, headers);
    setDraft(resolved);
    onApplyMapping(resolved);
    setStatusMessage(`Loaded preset "${found.name}".`);
  };

  const handleSavePreset = () => {
    const clean = presetName.trim();
    if (!clean) return;
    const updated = saveMappingPreset(clean, draft, headers);
    setPresets(updated);
    const saved = updated.find((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (saved) setSelectedPresetId(saved.id);
    setPresetName('');
    setStatusMessage(`Saved preset "${clean}" to this browser.`);
  };

  const handleDeletePreset = () => {
    if (!selectedPresetId) return;
    const target = presets.find((p) => p.id === selectedPresetId);
    const updated = deleteMappingPreset(selectedPresetId);
    setPresets(updated);
    setSelectedPresetId('');
    setStatusMessage(target ? `Deleted preset "${target.name}".` : null);
  };

  const handleAutoGuess = () => {
    const suggested = suggestColumnMapping(headers);
    setDraft(suggested);
    onApplyMapping(suggested);
    setStatusMessage('Matched columns by header name.');
  };

  return (
    <section
      aria-labelledby="column-mapper-heading"
      className="mb-6 rounded-lg border border-neutral-200 bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <div>
          <h2 id="column-mapper-heading" className="text-sm font-semibold text-neutral-900">
            Map columns ({mappedCount} of {MODEL_FIELDS.length} fields mapped)
          </h2>
          <p className="text-xs text-neutral-500">
            Match your CSV columns to product fields so FeedFix can check prices, barcodes and
            convert to Shopify, WooCommerce or Google.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((v) => !v)}
          className="text-xs font-medium text-accent hover:text-accent-hover focus:outline-none focus:underline"
        >
          {isOpen ? 'Hide mapping' : 'Edit mapping'}
        </button>
      </div>

      {isOpen && (
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label
                  htmlFor="preset-select"
                  className="block text-xs font-medium text-neutral-700"
                >
                  Saved presets
                </label>
                <select
                  id="preset-select"
                  value={selectedPresetId}
                  onChange={(e) => handleLoadPreset(e.target.value)}
                  className="mt-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                >
                  <option value="">
                    {presets.length === 0 ? 'No saved presets yet' : 'Choose a preset…'}
                  </option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {selectedPresetId && (
                <button
                  type="button"
                  onClick={handleDeletePreset}
                  className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-700 hover:border-red-300 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-accent/30"
                >
                  Delete preset
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label
                  htmlFor="preset-name-input"
                  className="block text-xs font-medium text-neutral-700"
                >
                  Save current mapping as preset
                </label>
                <input
                  id="preset-name-input"
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="e.g. Supplier A sheet"
                  className="mt-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <button
                type="button"
                disabled={!presetName.trim()}
                onClick={handleSavePreset}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                Save preset
              </button>
            </div>
          </div>

          <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {MODEL_FIELDS.map((field) => {
              const selectedCol = draft[field.key];
              const preview =
                selectedCol !== undefined ? (sampleRow[selectedCol] ?? '').trim() : '';

              return (
                <div key={field.key} className="space-y-1">
                  <label
                    htmlFor={`map-${field.key}`}
                    className="flex items-baseline justify-between gap-2 text-xs font-medium text-neutral-800"
                  >
                    <span>{field.label}</span>
                    <span className="font-normal text-neutral-400">{field.hint}</span>
                  </label>
                  <select
                    id={`map-${field.key}`}
                    value={selectedCol !== undefined ? String(selectedCol) : ''}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="">Not mapped</option>
                    {headers.map((h, idx) => (
                      <option key={`${idx}-${h}`} value={String(idx)}>
                        {h || `Column ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                  {preview && (
                    <p className="truncate font-mono text-[11px] text-neutral-500" title={preview}>
                      Row 2: {preview}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-3">
            <div aria-live="polite" role="status" className="text-xs text-neutral-600">
              {statusMessage ?? 'Presets are stored locally in your browser (localStorage).'}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={handleAutoGuess}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                Auto-match headers
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  onApplyMapping(draft);
                  setStatusMessage('Applied mapping and re-checked file.');
                }}
                className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                Apply mapping
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
