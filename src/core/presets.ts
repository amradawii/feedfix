import { normalizeHeader } from './model';
import { FieldMapping } from './platforms';

export type ModelFieldKey = keyof FieldMapping;

export interface ModelFieldDef {
  key: ModelFieldKey;
  label: string;
  hint: string;
}

export const MODEL_FIELDS: ModelFieldDef[] = [
  { key: 'title', label: 'Title', hint: 'Product name' },
  { key: 'sku', label: 'SKU', hint: 'Unique item code' },
  { key: 'regularPrice', label: 'Regular price', hint: 'Standard price' },
  { key: 'salePrice', label: 'Sale price', hint: 'Discounted price' },
  { key: 'barcode', label: 'Barcode / GTIN', hint: 'EAN, UPC, GTIN-14' },
  { key: 'vendor', label: 'Brand / Vendor', hint: 'Manufacturer or store brand' },
  { key: 'description', label: 'Description', hint: 'Text or HTML description' },
  { key: 'category', label: 'Category', hint: 'Product category path or ID' },
  { key: 'image', label: 'Image URL', hint: 'Main product image link' },
  { key: 'link', label: 'Product URL', hint: 'Landing page URL' },
  { key: 'inventoryQty', label: 'Stock quantity', hint: 'Numeric inventory count' },
  { key: 'availability', label: 'Availability', hint: 'In stock / out of stock' },
  { key: 'condition', label: 'Condition', hint: 'new, refurbished, used' },
  { key: 'status', label: 'Status', hint: 'active, draft, published' },
  { key: 'weight', label: 'Weight', hint: 'Weight in grams or with unit' },
  { key: 'tags', label: 'Tags', hint: 'Comma-separated tags' },
  { key: 'handle', label: 'Handle / Slug', hint: 'URL slug for grouping' },
  { key: 'id', label: 'Product ID', hint: 'Platform or supplier ID' },
];

export interface MappingPreset {
  id: string;
  name: string;
  updatedAt: string;
  /** Maps model field keys to original CSV column header names so presets survive column reordering. */
  columns: Partial<Record<ModelFieldKey, string>>;
}

const STORAGE_KEY = 'feedfix:mapping-presets:v1';

const HEADER_SUGGESTION_ALIASES: Record<ModelFieldKey, string[]> = {
  title: ['title', 'name', 'product name', 'product_name', 'item name', 'item_name'],
  sku: ['sku', 'item code', 'item_code', 'product code', 'product_code', 'code', 'model'],
  regularPrice: [
    'regular price',
    'regular_price',
    'price',
    'unit price',
    'unit_price',
    'retail price',
    'msrp',
  ],
  salePrice: ['sale price', 'sale_price', 'discount price', 'discount_price', 'special price'],
  barcode: ['barcode', 'gtin', 'ean', 'ean13', 'upc', 'isbn', 'variant barcode'],
  vendor: ['vendor', 'brand', 'manufacturer', 'supplier'],
  description: ['description', 'desc', 'body', 'body (html)', 'details'],
  category: ['category', 'categories', 'product category', 'google_product_category', 'department'],
  image: [
    'image',
    'image url',
    'image_url',
    'image_link',
    'image src',
    'photo',
    'photo_url',
    'picture',
  ],
  link: ['link', 'url', 'product url', 'product_url', 'permalink'],
  inventoryQty: ['stock', 'qty', 'quantity', 'inventory', 'inventory_qty', 'on_hand'],
  availability: ['availability', 'in stock', 'in_stock', 'stock status'],
  condition: ['condition', 'item condition'],
  status: ['status', 'published', 'state'],
  weight: ['weight', 'weight_g', 'weight (kg)', 'shipping_weight', 'grams'],
  tags: ['tags', 'keywords'],
  handle: ['handle', 'slug', 'url_handle'],
  id: ['id', 'product_id', 'item_id'],
};

export function suggestColumnMapping(headers: string[]): FieldMapping {
  const normHeaders = headers.map(normalizeHeader);
  const mapping: FieldMapping = {};
  const usedCols = new Set<number>();

  for (const field of MODEL_FIELDS) {
    const aliases = HEADER_SUGGESTION_ALIASES[field.key];
    for (const alias of aliases) {
      const idx = normHeaders.indexOf(alias);
      if (idx !== -1 && !usedCols.has(idx)) {
        mapping[field.key] = idx;
        usedCols.add(idx);
        break;
      }
    }
  }

  return mapping;
}

export function mappingToColumnNames(
  mapping: FieldMapping,
  headers: string[],
): Partial<Record<ModelFieldKey, string>> {
  const columns: Partial<Record<ModelFieldKey, string>> = {};
  for (const field of MODEL_FIELDS) {
    const colIdx = mapping[field.key];
    if (colIdx !== undefined && headers[colIdx] !== undefined) {
      columns[field.key] = headers[colIdx];
    }
  }
  return columns;
}

export function resolvePresetToMapping(preset: MappingPreset, headers: string[]): FieldMapping {
  const normHeaders = headers.map(normalizeHeader);
  const mapping: FieldMapping = {};

  for (const field of MODEL_FIELDS) {
    const savedHeader = preset.columns[field.key];
    if (!savedHeader) continue;
    const idx = normHeaders.indexOf(normalizeHeader(savedHeader));
    if (idx !== -1) {
      mapping[field.key] = idx;
    }
  }

  return mapping;
}

function getSafeStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function loadMappingPresets(): MappingPreset[] {
  const storage = getSafeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is MappingPreset =>
      Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && item.columns),
    );
  } catch {
    return [];
  }
}

export function saveMappingPreset(
  name: string,
  mapping: FieldMapping,
  headers: string[],
): MappingPreset[] {
  const cleanName = name.trim();
  const existing = loadMappingPresets();
  if (!cleanName) return existing;

  const columns = mappingToColumnNames(mapping, headers);
  const now = new Date().toISOString();
  const lower = cleanName.toLowerCase();
  const matchIdx = existing.findIndex((p) => p.name.toLowerCase() === lower);

  const nextPreset: MappingPreset = {
    id: matchIdx >= 0 ? existing[matchIdx].id : `preset-${Date.now()}-${existing.length + 1}`,
    name: cleanName,
    updatedAt: now,
    columns,
  };

  const next =
    matchIdx >= 0
      ? existing.map((p, idx) => (idx === matchIdx ? nextPreset : p))
      : [nextPreset, ...existing];

  const storage = getSafeStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors gracefully
    }
  }
  return next;
}

export function deleteMappingPreset(id: string): MappingPreset[] {
  const next = loadMappingPresets().filter((p) => p.id !== id);
  const storage = getSafeStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  }
  return next;
}
