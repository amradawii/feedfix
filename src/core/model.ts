export type Platform = 'shopify' | 'woocommerce' | 'google' | 'other';

export interface CellRef {
  /** 1-based spreadsheet row number (header = 1, first data row = 2) */
  row: number;
  /** 0-based column index */
  col: number;
  /** Exact header name as present in the file */
  columnName: string;
  /** Raw cell string before any normalization */
  raw: string;
}

export interface TrackedString {
  value: string;
  ref: CellRef;
}

export interface ProductImage {
  url: TrackedString;
  position?: TrackedString;
  alt?: TrackedString;
}

export interface ProductOption {
  name: string;
  nameRef?: CellRef;
  values: string[];
}

export interface Variant {
  /** 1-based spreadsheet row number for this variant */
  sourceRow: number;
  id?: TrackedString;
  sku?: TrackedString;
  /** Regular (non-discounted) price string; never parsed as floating-point */
  regularPrice?: TrackedString;
  /** Discounted sale price string; undefined when product is not on sale */
  salePrice?: TrackedString;
  /** Barcode / GTIN string; never parsed as number */
  barcode?: TrackedString;
  mpn?: TrackedString;
  identifierExists?: TrackedString;
  inventoryQty?: TrackedString;
  inventoryTracker?: TrackedString;
  inventoryPolicy?: TrackedString;
  fulfillmentService?: TrackedString;
  availability?: TrackedString;
  availabilityDate?: TrackedString;
  condition?: TrackedString;
  weightGrams?: number | null;
  weightUnit?: string;
  weight?: TrackedString;
  optionValues: Array<{ name: string; value: TrackedString }>;
  image?: TrackedString;
  link?: TrackedString;
  isDefaultVariant?: boolean;
}

export interface Product {
  /** 1-based spreadsheet row number of the primary product row */
  sourceRow: number;
  /** All 1-based source rows belonging to this product */
  sourceRows: number[];
  id?: TrackedString;
  handle?: TrackedString;
  itemGroupId?: TrackedString;
  title?: TrackedString;
  descriptionHtml?: TrackedString;
  shortDescription?: TrackedString;
  vendor?: TrackedString;
  productType?: TrackedString;
  wooType?: TrackedString;
  productCategory?: TrackedString;
  tags: TrackedString[];
  categories: TrackedString[];
  status?: TrackedString;
  published?: TrackedString;
  link?: TrackedString;
  images: ProductImage[];
  options: ProductOption[];
  variants: Variant[];
}

export type StructuralIssueKind =
  | 'shopify_non_contiguous_handle'
  | 'shopify_orphan_variant_row'
  | 'shopify_missing_option_value'
  | 'shopify_too_many_options'
  | 'shopify_too_many_variants'
  | 'woo_orphan_variation'
  | 'woo_variation_parent_not_variable'
  | 'google_missing_item_group_id';

export interface StructuralIssue {
  kind: StructuralIssueKind;
  row: number;
  col?: number;
  columnName?: string;
  detail: string;
  rawValue?: string;
}

export interface CatalogModel {
  platform: Platform;
  headers: string[];
  rowCount: number;
  products: Product[];
  structuralIssues: StructuralIssue[];
  columnMap: Record<string, number>;
  extraColumns: string[];
}

export function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function readCell(
  row: string[],
  headers: string[],
  rowNumber: number,
  col: number | undefined,
): TrackedString | undefined {
  if (col === undefined || col < 0 || col >= row.length) {
    return undefined;
  }
  const raw = row[col];
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  return {
    value: raw.trim(),
    ref: {
      row: rowNumber,
      col,
      columnName: headers[col] ?? `Column ${col + 1}`,
      raw,
    },
  };
}

export function readRawCell(
  row: string[],
  headers: string[],
  rowNumber: number,
  col: number | undefined,
): CellRef | undefined {
  if (col === undefined || col < 0) return undefined;
  const raw = row[col] ?? '';
  return {
    row: rowNumber,
    col,
    columnName: headers[col] ?? `Column ${col + 1}`,
    raw,
  };
}

export function parseWeightToGrams(raw: string, defaultUnit?: string): number | null {
  const cleaned = raw.trim().toLowerCase().replace(/,/g, '.');
  if (!cleaned) return null;
  const match = cleaned.match(
    /^([+-]?\d+(?:\.\d+)?)\s*(g|gr|grams?|kg|kilograms?|lb|lbs|pounds?|oz|ounces?)?$/,
  );
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num < 0) return null;
  const unit = match[2] ?? defaultUnit ?? 'g';

  if (unit === 'kg' || unit === 'kilogram' || unit === 'kilograms') {
    return Math.round(num * 1000);
  }
  if (unit === 'lb' || unit === 'lbs' || unit === 'pound' || unit === 'pounds') {
    return Math.round(num * 453.59237);
  }
  if (unit === 'oz' || unit === 'ounce' || unit === 'ounces') {
    return Math.round(num * 28.349523);
  }
  return Math.round(num);
}
