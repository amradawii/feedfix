import fs from 'node:fs';
import { expect, Page, test } from '@playwright/test';

function trackRuntimeErrors(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
  });
  return { consoleErrors, pageErrors };
}

async function readDownloadBuffer(
  page: Page,
  trigger: () => Promise<void>,
): Promise<{
  fileName: string;
  bytes: Buffer;
  text: string;
}> {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const filePath = await download.path();
  if (!filePath) {
    throw new Error('Download did not produce a local file path');
  }
  const bytes = fs.readFileSync(filePath);
  return {
    fileName: download.suggestedFilename(),
    bytes,
    text: bytes.toString('utf8'),
  };
}

function buildWin1256ArabicCsv(): Buffer {
  // Semicolon-delimited Shopify CSV saved as Windows-1256:
  // Title: "القميص القطني" = C7 E1 DE E3 ED D5 20 C7 E1 DE D8 E4 ED
  const head = Buffer.from('Handle;Title;Variant Price;Variant Barcode;Status\nshirt-ar;', 'ascii');
  const arabic = Buffer.from([
    0xc7, 0xe1, 0xde, 0xe3, 0xed, 0xd5, 0x20, 0xc7, 0xe1, 0xde, 0xd8, 0xe4, 0xed,
  ]);
  const tail = Buffer.from(';120,50;36000291452;Active\n', 'ascii');
  return Buffer.concat([head, arabic, tail]);
}

function build50kShopifyCsv(): Buffer {
  const lines = [
    'Handle,Title,Body (HTML),Vendor,Product Category,Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Grams,Variant Inventory Policy,Variant Fulfillment Service,Variant Price,Variant Compare At Price,Variant Barcode,Image Src,Status',
  ];
  for (let i = 1; i <= 50_000; i++) {
    const price = i % 5 === 0 ? '"1,200 EGP"' : '45.00';
    const barcode = i % 10 === 0 ? '36000291452' : '4006381333931';
    const status = i % 20 === 0 ? 'Active' : 'active';
    lines.push(
      `item-${i},Product ${i},<p>Desc ${i}</p>,Northwind,Apparel & Accessories > Clothing,Shirts,cotton,TRUE,Title,Default Title,SKU-${i},250,deny,manual,${price},,${barcode},https://example.com/img/${i}.jpg,${status}`,
    );
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

test.describe('FeedFix end-to-end flows', () => {
  test('Shopify sample runs all 4 steps and exported CSV + change log match accept/reject choices', async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);
    await page.goto('/');

    // Always-visible "Why not just ask a chatbot?" section
    await expect(page.getByRole('heading', { name: 'Why not just ask a chatbot?' })).toBeVisible();
    await expect(
      page.getByText(
        'AI is great for writing product descriptions. FeedFix makes sure the file is correct.',
      ),
    ).toBeVisible();

    // 1. Upload sample
    await page.getByRole('button', { name: /Shopify sample/i }).click();
    await expect(page.getByRole('heading', { name: 'Problems found' })).toBeVisible();
    await expect(page.getByText('Price has text in it')).toBeVisible();
    await expect(
      page.getByText('Barcode turned into scientific notation (unrecoverable)'),
    ).toBeVisible();

    // 2. Accept safe fixes -> 3. Review -> reject one specific barcode fix
    await page.getByRole('button', { name: /Fix all safe/i }).click();
    await page.getByRole('button', { name: /Review changes/i }).click();
    await expect(page.getByRole('heading', { name: 'Review changes' })).toBeVisible();

    await page.getByRole('button', { name: /Reject change on row 3 Variant Barcode/i }).click();

    // 4. Export Same format + change log
    await page.getByRole('button', { name: /Continue to export/i }).click();
    await expect(page.getByRole('heading', { name: 'Export clean file' })).toBeVisible();

    const clean = await readDownloadBuffer(page, () =>
      page.getByRole('button', { name: /Download clean CSV/i }).click(),
    );
    const log = await readDownloadBuffer(page, () =>
      page.getByRole('button', { name: /Download change log CSV/i }).click(),
    );

    expect(clean.fileName).toBe('shopify-sample-cleaned.csv');
    expect(clean.text).toContain(',1200.00,1450.00,');
    expect(clean.text).toContain('القميص الكتان');
    expect(clean.text).toContain(',36000291452,'); // rejected fix untouched
    expect(clean.text).toContain(',6.29E+12,'); // unrecoverable barcode untouched

    expect(log.fileName).toBe('shopify-sample-changelog.csv');
    expect(log.text).toContain('"1,200 EGP",1200.00');
    expect(log.text).not.toContain('036000291452');

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  });

  test('WooCommerce sample converts cleanly to Shopify with non-inverted sale prices', async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);
    await page.goto('/');

    await page.getByRole('button', { name: /WooCommerce sample/i }).click();
    await expect(page.getByRole('heading', { name: 'Problems found' })).toBeVisible();
    await expect(page.getByLabel('Detected platform format')).toHaveValue('woocommerce');
    await expect(page.getByLabel('Detected delimiter')).toHaveValue(';');
    await expect(page.getByText('WooCommerce variation has no matching parent')).toBeVisible();

    await page.getByRole('button', { name: /Fix all safe/i }).click();
    await page.getByRole('button', { name: /4 Export/i }).click();
    await page.getByRole('radio', { name: /^Shopify/i }).click();

    const converted = await readDownloadBuffer(page, () =>
      page.getByRole('button', { name: /Download clean CSV/i }).click(),
    );

    expect(converted.fileName).toBe('woocommerce-sample-shopify.csv');
    expect(converted.text).toContain('Handle,Title,Body (HTML),Vendor,Product Category');
    // Woo Regular 49,90 / Sale 39,90 -> Shopify Variant Price 39.90 / Compare At 49.90
    expect(converted.text).toContain(',39.90,49.90,4006381333931,');
    expect(converted.text).toContain('كوب سيراميك يدوي');

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  });

  test('Google Merchant Center sample checks lazy-loaded taxonomy, backorder date, and exports clean TSV', async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);
    await page.goto('/');

    await page.getByRole('button', { name: /Google Merchant Center sample/i }).click();
    await expect(page.getByRole('heading', { name: 'Problems found' })).toBeVisible();
    await expect(page.getByText('Unknown Google product category')).toBeVisible();
    await expect(
      page.getByText('Missing or invalid availability_date for preorder/backorder'),
    ).toBeVisible();

    await page.getByRole('button', { name: /Fix all safe/i }).click();
    await page.getByRole('button', { name: /4 Export/i }).click();

    const exported = await readDownloadBuffer(page, () =>
      page.getByRole('button', { name: /Download clean CSV/i }).click(),
    );

    expect(exported.fileName).toBe('google-sample-cleaned.tsv');
    expect(exported.text).toContain('\tin_stock\t');
    expect(exported.text).toContain('\t450.00 EGP\t');
    expect(exported.text).toContain('https://example.com/products/handwoven%20rug');

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  });

  test('Conversion paths: Shopify -> Google (pre-filled EGP + derived links) and Shopify -> WooCommerce (no core GTIN/brand)', async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);
    await page.goto('/');

    await page.getByRole('button', { name: /Shopify sample/i }).click();
    await expect(page.getByRole('heading', { name: 'Problems found' })).toBeVisible();
    await page.getByRole('button', { name: /Fix all safe/i }).click();
    await page.getByRole('button', { name: /4 Export/i }).click();

    // Shopify -> Google
    await page.getByRole('radio', { name: /Google Merchant Center/i }).click();
    await expect(page.getByLabel('Currency code (optional)')).toHaveValue('EGP');
    await page.getByLabel('Store base URL (optional)').fill('https://northwind.example.com');

    const gmc = await readDownloadBuffer(page, () =>
      page.getByRole('button', { name: /Download Google TSV/i }).click(),
    );
    expect(gmc.text).toContain('https://northwind.example.com/products/cotton-oxford-shirt');
    expect(gmc.text).toContain('1450.00 EGP\t1200.00 EGP');

    // Shopify -> WooCommerce
    await page.getByRole('radio', { name: /^WooCommerce/i }).click();
    await expect(page.getByText(/WooCommerce core has no native barcode column/i)).toBeVisible();
    await expect(page.getByText(/WooCommerce core has no native brand column/i)).toBeVisible();

    const woo = await readDownloadBuffer(page, () =>
      page.getByRole('button', { name: /Download clean CSV/i }).click(),
    );
    expect(woo.text).not.toContain('GTIN, UPC, EAN, or ISBN');

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  });

  test('Decodes raw Windows-1256 Arabic CSV with semicolon delimiter and exports UTF-8 with BOM', async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);
    await page.goto('/');

    await page.locator('#csv-file-input').setInputFiles({
      name: 'arabic-win1256.csv',
      mimeType: 'text/csv',
      buffer: buildWin1256ArabicCsv(),
    });

    await expect(page.getByRole('heading', { name: 'Problems found' })).toBeVisible();
    await expect(page.getByText('Windows-1256 (Arabic)').first()).toBeVisible();
    await expect(page.getByLabel('Detected delimiter')).toHaveValue(';');
    await expect(page.getByText('Price uses a decimal comma')).toBeVisible();

    await page.getByRole('button', { name: /Fix all safe/i }).click();
    await page.getByRole('button', { name: /4 Export/i }).click();

    // UTF-8 BOM checkbox auto-checked for Arabic content
    await expect(page.getByRole('checkbox', { name: /Add UTF-8 BOM/i })).toBeChecked();

    const exported = await readDownloadBuffer(page, () =>
      page.getByRole('button', { name: /Download clean CSV/i }).click(),
    );

    // Confirm raw UTF-8 BOM bytes EF BB BF
    expect(exported.bytes[0]).toBe(0xef);
    expect(exported.bytes[1]).toBe(0xbb);
    expect(exported.bytes[2]).toBe(0xbf);
    expect(exported.text).toContain('القميص القطني');
    expect(exported.text).toContain(',120.50,036000291452,active');

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  });

  test('Handles a 50,000-row CSV in the Web Worker and virtualizes the Review table smoothly', async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);
    await page.goto('/');

    const started = Date.now();
    await page.locator('#csv-file-input').setInputFiles({
      name: 'large-50k.csv',
      mimeType: 'text/csv',
      buffer: build50kShopifyCsv(),
    });

    await expect(page.getByRole('heading', { name: 'Problems found' })).toBeVisible({
      timeout: 30_000,
    });
    const elapsedMs = Date.now() - started;
    expect(elapsedMs).toBeLessThan(20_000);
    await expect(page.getByText('50,000 rows')).toBeVisible();

    await page.getByRole('button', { name: /Fix all safe/i }).click();
    await page.getByRole('button', { name: /Review changes/i }).click();
    await expect(page.getByRole('heading', { name: 'Review changes' })).toBeVisible();

    const tableRegion = page.getByRole('region', { name: 'Proposed changes table' });
    await tableRegion.evaluate((el) => {
      el.scrollTop = 250_000;
    });
    await page.waitForTimeout(100);

    const domRows = await page.locator('tbody tr').count();
    expect(domRows).toBeLessThan(60);

    // Only the review table's own thead may be sticky
    const stickyTags = await page.evaluate(() => {
      const tags: string[] = [];
      for (const el of document.querySelectorAll('*')) {
        if (getComputedStyle(el).position === 'sticky') {
          tags.push(el.tagName);
        }
      }
      return tags;
    });
    expect(stickyTags).toEqual(['THEAD']);

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  });

  test('Maps columns of an unknown CSV, persists preset in localStorage, and reloads across reordered headers', async ({
    page,
  }) => {
    const errors = trackRuntimeErrors(page);
    await page.goto('/');

    const sheetA = Buffer.from(
      'col_sku,col_name,col_price,col_code\nS-1,Linen Apron,"1,250 EGP",36000291452\n',
      'utf8',
    );
    await page.locator('#csv-file-input').setInputFiles({
      name: 'supplier-a.csv',
      mimeType: 'text/csv',
      buffer: sheetA,
    });

    await expect(page.getByRole('heading', { name: /Map columns/i })).toBeVisible();
    await page.getByLabel(/^SKU/i).selectOption('0');
    await page.getByLabel(/^Title/i).selectOption('1');
    await page.getByLabel(/^Regular price/i).selectOption('2');
    await page.getByLabel(/^Barcode \/ GTIN/i).selectOption('3');

    await page.getByLabel(/Save current mapping as preset/i).fill('Supplier A');
    await page.getByRole('button', { name: 'Save preset' }).click();
    await page.getByRole('button', { name: 'Apply mapping' }).click();
    await expect(page.getByText('Price has text in it')).toBeVisible();

    // Reload browser and upload a reordered supplier sheet
    await page.reload();
    const sheetB = Buffer.from(
      'col_code,col_price,col_name,col_sku\n36000291452,"950 EGP",Cotton Napkin,S-2\n',
      'utf8',
    );
    await page.locator('#csv-file-input').setInputFiles({
      name: 'supplier-b.csv',
      mimeType: 'text/csv',
      buffer: sheetB,
    });

    await expect(page.getByRole('heading', { name: /Map columns/i })).toBeVisible();
    await page.getByLabel('Saved presets').selectOption({ label: 'Supplier A' });
    await expect(page.getByText('Price has text in it')).toBeVisible();
    await expect(page.getByText('Barcode lost its leading zero')).toBeVisible();

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  });
});
