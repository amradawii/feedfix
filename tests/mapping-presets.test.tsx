import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import {
  deleteMappingPreset,
  loadMappingPresets,
  resolvePresetToMapping,
  saveMappingPreset,
  suggestColumnMapping,
} from '../src/core/presets';
import { DownloadPayload } from '../src/ui/ExportPanel';

describe('manual column mapping and localStorage presets', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('saves, loads, resolves across reordered columns, and deletes presets', () => {
    const headersA = ['item_code', 'product_name', 'unit_price', 'ean'];
    const suggested = suggestColumnMapping(headersA);
    expect(suggested).toEqual({ sku: 0, title: 1, regularPrice: 2, barcode: 3 });

    const afterSave = saveMappingPreset('Supplier Cairo', suggested, headersA);
    expect(afterSave).toHaveLength(1);
    expect(loadMappingPresets()).toHaveLength(1);

    // Reordered headers in next week's supplier sheet still resolve cleanly by header name
    const headersB = ['ean', 'extra_col', 'product_name', 'unit_price', 'item_code'];
    const resolved = resolvePresetToMapping(afterSave[0], headersB);
    expect(resolved).toEqual({ barcode: 0, title: 2, regularPrice: 3, sku: 4 });

    const afterDelete = deleteMappingPreset(afterSave[0].id);
    expect(afterDelete).toHaveLength(0);
    expect(loadMappingPresets()).toHaveLength(0);
  });

  it('maps an unknown CSV in the UI, saves a preset, runs checks, and converts to Shopify', async () => {
    const downloads: DownloadPayload[] = [];
    render(<App onDownloadFile={(p) => downloads.push(p)} />);

    const unknownCsv = [
      'col_code,col_label,col_amount,col_gtin',
      'SUP-01,Linen Apron,"1,250 EGP",36000291452',
      'SUP-02,Cotton Towel,450.00,4006381333931',
    ].join('\n');

    const file = new File([unknownCsv], 'supplier-export.csv', { type: 'text/csv' });
    // jsdom File.prototype.arrayBuffer polyfill if needed
    if (!file.arrayBuffer) {
      Object.defineProperty(file, 'arrayBuffer', {
        value: async () => new TextEncoder().encode(unknownCsv).buffer,
      });
    }

    const input = document.getElementById('csv-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Map columns/i })).toBeInTheDocument();
    });

    // Manually map the non-obvious columns
    fireEvent.change(screen.getByLabelText(/SKU/i), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/^Title/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Regular price/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Barcode \/ GTIN/i), { target: { value: '3' } });

    // Save preset to localStorage
    fireEvent.change(screen.getByLabelText(/Save current mapping as preset/i), {
      target: { value: 'Supplier Sheet' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }));
    expect(loadMappingPresets().some((p) => p.name === 'Supplier Sheet')).toBe(true);

    // Apply mapping and confirm price + barcode rules fire on the mapped columns
    fireEvent.click(screen.getByRole('button', { name: 'Apply mapping' }));

    await waitFor(() => {
      expect(screen.getByText('Price has text in it')).toBeInTheDocument();
      expect(screen.getByText('Barcode lost its leading zero')).toBeInTheDocument();
    });

    // Accept safe fixes and export as Shopify CSV
    fireEvent.click(screen.getByRole('button', { name: /Fix all safe/i }));
    fireEvent.click(screen.getByRole('button', { name: /4 Export/i }));
    fireEvent.click(screen.getByRole('radio', { name: /^Shopify/i }));
    fireEvent.click(screen.getByRole('button', { name: /Download clean CSV/i }));

    expect(downloads).toHaveLength(1);
    expect(downloads[0].content).toContain('linen-apron,Linen Apron');
    expect(downloads[0].content).toContain(',1250.00,,036000291452,');
  });
});
