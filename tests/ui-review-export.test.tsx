import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App';
import { DownloadPayload } from '../src/ui/ExportPanel';

describe('review table and export panel workflow', () => {
  it('reflects per-change accept and reject decisions in the exported CSV and change log', async () => {
    const downloads: DownloadPayload[] = [];
    render(<App onDownloadFile={(payload) => downloads.push(payload)} />);

    // 1. Load Shopify sample
    fireEvent.click(screen.getByRole('button', { name: /Shopify sample/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Problems found' })).toBeInTheDocument();
    });

    // 2. Accept all safe fixes, then open Review
    fireEvent.click(screen.getByRole('button', { name: /Fix all safe/i }));
    fireEvent.click(screen.getByRole('button', { name: /Review changes/i }));

    expect(screen.getByRole('heading', { name: 'Review changes' })).toBeInTheDocument();

    // 3. Reject one specific safe change: row 3 Variant Barcode leading zero restore
    const rejectBarcodeBtn = screen.getByRole('button', {
      name: /Reject change on row 3 Variant Barcode/i,
    });
    fireEvent.click(rejectBarcodeBtn);

    // 4. Move to Export and download both clean CSV and change log
    fireEvent.click(screen.getByRole('button', { name: /Continue to export/i }));
    expect(screen.getByRole('heading', { name: 'Export clean file' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Download clean CSV/i }));
    fireEvent.click(screen.getByRole('button', { name: /Download change log CSV/i }));

    expect(downloads).toHaveLength(2);
    const cleanedCsv = downloads[0].content;
    const changeLogCsv = downloads[1].content;

    // Accepted fix IS in exported CSV ("1,200 EGP" -> "1200.00", mojibake -> "القميص الكتان")
    expect(cleanedCsv).toContain(',1200.00,1450.00,');
    expect(cleanedCsv).toContain('القميص الكتان');
    expect(changeLogCsv).toContain('"1,200 EGP",1200.00');

    // Rejected fix is NOT in exported CSV or change log ("36000291452" untouched)
    expect(cleanedCsv).toContain(',36000291452,');
    expect(changeLogCsv).not.toContain('036000291452');
  });

  it('jumps from a problem rule directly into Review filtered to that rule', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Shopify sample/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Problems found' })).toBeInTheDocument();
    });

    // Click the first "Review rows" button
    const reviewButtons = screen.getAllByRole('button', { name: 'Review rows' });
    fireEvent.click(reviewButtons[0]);

    expect(screen.getByRole('heading', { name: 'Review changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filter' })).toBeInTheDocument();
  });

  it('pre-fills unambiguous currency and derives Shopify links on Google export, and reports WooCommerce limitations', async () => {
    const downloads: DownloadPayload[] = [];
    render(<App onDownloadFile={(payload) => downloads.push(payload)} />);

    fireEvent.click(screen.getByRole('button', { name: /Shopify sample/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Problems found' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /4 Export/i }));

    // Select Google Merchant Center target
    fireEvent.click(screen.getByRole('radio', { name: /Google Merchant Center/i }));

    // Currency code pre-filled unambiguously as EGP from "1,200 EGP"
    const currencyInput = screen.getByLabelText('Currency code (optional)');
    expect(currencyInput).toHaveValue('EGP');

    // Enter Store base URL and export Google TSV
    const baseUrlInput = screen.getByLabelText('Store base URL (optional)');
    fireEvent.change(baseUrlInput, { target: { value: 'https://shop.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Download Google TSV/i }));

    expect(downloads[0].content).toContain('https://shop.example.com/products/cotton-oxford-shirt');
    expect(downloads[0].content).toContain('1450.00 EGP');

    // Switch target to WooCommerce and check late-2023 missing core barcode/brand notices
    fireEvent.click(screen.getByRole('radio', { name: /WooCommerce/i }));
    expect(screen.getByText(/WooCommerce core has no native barcode column/i)).toBeInTheDocument();
    expect(screen.getByText(/WooCommerce core has no native brand column/i)).toBeInTheDocument();
  });
});
