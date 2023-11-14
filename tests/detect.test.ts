import { describe, expect, it } from 'vitest';
import { detectPlatform } from '../src/core/detect';

describe('platform detection', () => {
  it('detects Shopify headers including legacy Standardized Product Type alias', () => {
    const res = detectPlatform([
      'Handle',
      'Title',
      'Body (HTML)',
      'Vendor',
      'Standardized Product Type',
      'Option1 Name',
      'Option1 Value',
      'Variant Price',
      'Variant SKU',
    ]);
    expect(res.platform).toBe('shopify');
    expect(res.confidence).toBe('high');
  });

  it('detects WooCommerce headers with unit-qualified Weight and Attributes', () => {
    const res = detectPlatform([
      'ID',
      'Type',
      'SKU',
      'Name',
      'Published',
      'In stock?',
      'Regular price',
      'Sale price',
      'Weight (lbs)',
      'Parent',
      'Attribute 1 name',
      'Attribute 1 value(s)',
    ]);
    expect(res.platform).toBe('woocommerce');
    expect(res.confidence).toBe('high');
  });

  it('detects Google Merchant Center headers with underscores or spaces', () => {
    const res = detectPlatform([
      'id',
      'item group id',
      'title',
      'description',
      'link',
      'image link',
      'availability',
      'price',
      'brand',
      'gtin',
      'condition',
    ]);
    expect(res.platform).toBe('google');
    expect(res.confidence).toBe('high');
  });

  it('falls back to other for unknown generic CSV headers', () => {
    const res = detectPlatform(['col_a', 'col_b', 'cost', 'notes']);
    expect(res.platform).toBe('other');
    expect(res.confidence).toBe('low');
  });
});
