import shopifySample from './shopify-sample.csv?raw';
import woocommerceSample from './woocommerce-sample.csv?raw';
import googleSample from './google-sample.csv?raw';
import { Platform } from '../core/model';

export interface SampleFeed {
  id: Exclude<Platform, 'other'>;
  name: string;
  fileName: string;
  description: string;
  content: string;
}

export const SAMPLE_FEEDS: SampleFeed[] = [
  {
    id: 'shopify',
    name: 'Shopify sample',
    fileName: 'shopify-sample.csv',
    description: '5 products, variants, Arabic mojibake, price text and Excel barcode issues',
    content: shopifySample,
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce sample',
    fileName: 'woocommerce-sample.csv',
    description:
      'Semicolon-delimited export with variable product, orphan variation and Arabic text',
    content: woocommerceSample,
  },
  {
    id: 'google',
    name: 'Google Merchant Center sample',
    fileName: 'google-sample.tsv',
    description: 'Tab-delimited feed with missing currency, promo title text and backorder checks',
    content: googleSample,
  },
];
