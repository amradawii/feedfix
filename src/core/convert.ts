import { CatalogModel, Platform } from './model';
import { GoogleExportOptions } from './platforms/google';
import { SHOPIFY_MAX_OPTIONS_2023, SHOPIFY_MAX_VARIANTS_2023 } from './platforms/shopify';
import { parsePriceValue } from './rules/price';

export type ExportTarget = 'same' | 'shopify' | 'woocommerce' | 'google';

export interface ConversionNotice {
  kind: 'missing' | 'lost' | 'note';
  field: string;
  count: number;
  message: string;
}

export interface ConversionReport {
  sourcePlatform: Platform;
  target: ExportTarget;
  effectiveTargetPlatform: Platform;
  detectedCurrency: string | null;
  canDeriveGoogleLinks: boolean;
  notices: ConversionNotice[];
}

/**
 * Detects a single unambiguous ISO-4217 currency code from the file's own price cells.
 * Returns null if no currency is present or if multiple different currencies appear.
 */
export function detectUnambiguousCurrency(catalog: CatalogModel): string | null {
  const found = new Set<string>();

  for (const product of catalog.products) {
    for (const variant of product.variants) {
      for (const cell of [variant.regularPrice, variant.salePrice]) {
        if (!cell) continue;
        const parsed = parsePriceValue(cell.value);
        if (parsed.ok && parsed.isoCurrency) {
          found.add(parsed.isoCurrency);
          if (found.size > 1) return null;
        }
      }
    }
  }

  return found.size === 1 ? [...found][0] : null;
}

export function analyzeConversion(
  catalog: CatalogModel,
  target: ExportTarget,
  googleOptions: GoogleExportOptions = {},
): ConversionReport {
  const effectiveTargetPlatform: Platform = target === 'same' ? catalog.platform : target;
  const detectedCurrency = detectUnambiguousCurrency(catalog);
  const canDeriveGoogleLinks = catalog.platform === 'shopify';
  const notices: ConversionNotice[] = [];

  if (target === 'same') {
    notices.push({
      kind: 'note',
      field: 'columns',
      count: catalog.headers.length,
      message: `All ${catalog.headers.length} columns from your original file are kept as-is, with only your accepted changes applied.`,
    });
    return {
      sourcePlatform: catalog.platform,
      target,
      effectiveTargetPlatform,
      detectedCurrency,
      canDeriveGoogleLinks,
      notices,
    };
  }

  if (target === 'woocommerce') {
    let barcodeCount = 0;
    let brandCount = 0;

    for (const product of catalog.products) {
      if (product.vendor?.value) brandCount++;
      for (const variant of product.variants) {
        if (variant.barcode?.value) barcodeCount++;
      }
    }

    if (barcodeCount > 0) {
      notices.push({
        kind: 'lost',
        field: 'barcode',
        count: barcodeCount,
        message: `WooCommerce core has no native barcode column: ${barcodeCount} barcode value${
          barcodeCount === 1 ? '' : 's'
        } will be omitted.`,
      });
    }
    if (brandCount > 0) {
      notices.push({
        kind: 'lost',
        field: 'brand',
        count: brandCount,
        message: `WooCommerce core has no native brand column: ${brandCount} brand value${
          brandCount === 1 ? '' : 's'
        } will be omitted.`,
      });
    }
    if (catalog.extraColumns.length > 0 && catalog.platform !== 'woocommerce') {
      notices.push({
        kind: 'lost',
        field: 'extraColumns',
        count: catalog.extraColumns.length,
        message: `${catalog.extraColumns.length} platform-specific column${
          catalog.extraColumns.length === 1 ? '' : 's'
        } from the source file will not be carried over.`,
      });
    }
  }

  if (target === 'shopify') {
    let overOptions = 0;
    let overVariants = 0;
    let hasInventoryQty = 0;
    let lostLinks = 0;
    let lostCondition = 0;

    for (const product of catalog.products) {
      if (product.options.length > SHOPIFY_MAX_OPTIONS_2023) overOptions++;
      if (product.variants.length > SHOPIFY_MAX_VARIANTS_2023) overVariants++;
      if (product.link?.value) lostLinks++;
      for (const variant of product.variants) {
        if (variant.inventoryQty?.value) hasInventoryQty++;
        if (variant.condition?.value) lostCondition++;
      }
    }

    if (overOptions > 0) {
      notices.push({
        kind: 'lost',
        field: 'options',
        count: overOptions,
        message: `Shopify supports up to ${SHOPIFY_MAX_OPTIONS_2023} options per product: ${overOptions} product${
          overOptions === 1 ? '' : 's'
        } have extra options that will be dropped.`,
      });
    }
    if (overVariants > 0) {
      notices.push({
        kind: 'missing',
        field: 'variants',
        count: overVariants,
        message: `${overVariants} product${
          overVariants === 1 ? '' : 's'
        } exceed Shopify's ${SHOPIFY_MAX_VARIANTS_2023}-variant limit per product.`,
      });
    }
    if (hasInventoryQty > 0) {
      notices.push({
        kind: 'note',
        field: 'Variant Inventory Qty',
        count: hasInventoryQty,
        message:
          'Variant Inventory Qty is supported for single-location Shopify stores only; multi-location stores use Shopify Inventory CSV.',
      });
    }
    if (lostLinks > 0 && catalog.platform === 'google') {
      notices.push({
        kind: 'lost',
        field: 'link',
        count: lostLinks,
        message: `Shopify generates product URLs from Handle: ${lostLinks} source link URL${
          lostLinks === 1 ? '' : 's'
        } will not be exported.`,
      });
    }
    if (lostCondition > 0 && catalog.platform === 'google') {
      notices.push({
        kind: 'lost',
        field: 'condition',
        count: lostCondition,
        message: `Shopify product CSV has no condition column: ${lostCondition} condition value${
          lostCondition === 1 ? '' : 's'
        } will be omitted.`,
      });
    }
    if (catalog.extraColumns.length > 0 && catalog.platform !== 'shopify') {
      notices.push({
        kind: 'lost',
        field: 'extraColumns',
        count: catalog.extraColumns.length,
        message: `${catalog.extraColumns.length} platform-specific column${
          catalog.extraColumns.length === 1 ? '' : 's'
        } from the source file will not be carried over.`,
      });
    }
  }

  if (target === 'google') {
    const providedCurrency = googleOptions.currencyCode?.trim().toUpperCase() || '';
    const providedBaseUrl = googleOptions.storeBaseUrl?.trim() || '';

    let missingLink = 0;
    let missingCurrency = 0;
    let missingBrand = 0;
    let missingGtinMpn = 0;
    let missingCondition = 0;
    let missingAvailability = 0;
    let missingImage = 0;
    let missingDescription = 0;
    let totalItems = 0;

    for (const product of catalog.products) {
      const variants =
        product.variants.length > 0
          ? product.variants
          : [{ sourceRow: product.sourceRow, optionValues: [] }];
      const hasDesc = Boolean(product.descriptionHtml?.value || product.shortDescription?.value);

      for (const variant of variants) {
        totalItems++;
        const hasExistingLink = Boolean(variant.link?.value || product.link?.value);
        const canDerive =
          catalog.platform === 'shopify' &&
          Boolean(providedBaseUrl) &&
          Boolean(product.handle?.value);
        if (!hasExistingLink && !canDerive) missingLink++;

        const parsedReg = variant.regularPrice ? parsePriceValue(variant.regularPrice.value) : null;
        if (parsedReg && parsedReg.ok && !parsedReg.isoCurrency && !providedCurrency) {
          missingCurrency++;
        }

        const idExistsNo =
          variant.identifierExists?.value.toLowerCase() === 'no' ||
          variant.identifierExists?.value.toLowerCase() === 'false';
        if (!idExistsNo && !product.vendor?.value) missingBrand++;
        if (!idExistsNo && !variant.barcode?.value && !variant.mpn?.value) missingGtinMpn++;
        if (!variant.condition?.value) missingCondition++;

        const hasAvail = Boolean(variant.availability?.value || variant.inventoryQty?.value);
        if (!hasAvail) missingAvailability++;

        const hasImg = Boolean(variant.image?.value || product.images[0]?.url.value);
        if (!hasImg) missingImage++;
        if (!hasDesc) missingDescription++;
      }
    }

    if (missingLink > 0) {
      const linkMsg =
        catalog.platform === 'woocommerce'
          ? `Google needs link for ${missingLink} item${
              missingLink === 1 ? '' : 's'
            }: WooCommerce CSVs do not contain product URLs.`
          : catalog.platform === 'shopify'
            ? `Google needs link for ${missingLink} item${
                missingLink === 1 ? '' : 's'
              }: enter your Store base URL to build /products/<handle> links.`
            : `Google needs link for ${missingLink} item${
                missingLink === 1 ? '' : 's'
              }: no URL column found.`;
      notices.push({ kind: 'missing', field: 'link', count: missingLink, message: linkMsg });
    }

    if (missingCurrency > 0) {
      notices.push({
        kind: 'missing',
        field: 'currency',
        count: missingCurrency,
        message: `Google needs a 3-letter currency code (e.g. USD, EGP) for ${missingCurrency} price${
          missingCurrency === 1 ? '' : 's'
        }: enter Currency code above.`,
      });
    }

    if (missingBrand > 0) {
      notices.push({
        kind: 'missing',
        field: 'brand',
        count: missingBrand,
        message: `Google needs brand for ${missingBrand} item${
          missingBrand === 1 ? '' : 's'
        }: no brand value found.`,
      });
    }

    if (missingGtinMpn > 0) {
      notices.push({
        kind: 'missing',
        field: 'gtin',
        count: missingGtinMpn,
        message: `Google expects gtin or mpn for ${missingGtinMpn} item${
          missingGtinMpn === 1 ? '' : 's'
        } (or set identifier_exists to "no" for custom goods).`,
      });
    }

    if (missingCondition > 0) {
      notices.push({
        kind: 'missing',
        field: 'condition',
        count: missingCondition,
        message: `Google needs condition (new, refurbished or used) for ${missingCondition} item${
          missingCondition === 1 ? '' : 's'
        }: left blank instead of guessing.`,
      });
    }

    if (missingAvailability > 0) {
      notices.push({
        kind: 'missing',
        field: 'availability',
        count: missingAvailability,
        message: `Google needs availability for ${missingAvailability} of ${totalItems} item${
          totalItems === 1 ? '' : 's'
        }.`,
      });
    }

    if (missingImage > 0) {
      notices.push({
        kind: 'missing',
        field: 'image_link',
        count: missingImage,
        message: `Google needs image_link for ${missingImage} item${
          missingImage === 1 ? '' : 's'
        }.`,
      });
    }

    if (missingDescription > 0) {
      notices.push({
        kind: 'missing',
        field: 'description',
        count: missingDescription,
        message: `Google needs description for ${missingDescription} item${
          missingDescription === 1 ? '' : 's'
        }.`,
      });
    }

    const taggedProducts = catalog.products.filter((p) => p.tags.length > 0).length;
    if (taggedProducts > 0) {
      notices.push({
        kind: 'lost',
        field: 'tags',
        count: taggedProducts,
        message: `Google Merchant Center has no tags column: tags on ${taggedProducts} product${
          taggedProducts === 1 ? '' : 's'
        } will not be exported.`,
      });
    }
  }

  return {
    sourcePlatform: catalog.platform,
    target,
    effectiveTargetPlatform,
    detectedCurrency,
    canDeriveGoogleLinks,
    notices,
  };
}
