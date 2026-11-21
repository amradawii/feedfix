import { TrackedString } from '../model';
import { ALL_PLATFORMS, createProblemId, Problem, RuleRunner } from './types';

interface UrlCheckTarget {
  tracked: TrackedString;
  /** True when the raw cell holds a comma-separated list of URLs (WooCommerce Images / Google additional_image_link) */
  isCommaList: boolean;
}

function isValidAbsoluteHttpUrl(candidate: string): boolean {
  if (!/^https?:\/\//i.test(candidate)) return false;
  try {
    const parsed = new URL(candidate);
    return Boolean(parsed.hostname && parsed.hostname.includes('.'));
  } catch {
    return false;
  }
}

function encodeSpacesInUrl(url: string): string {
  return url.trim().replace(/ /g, '%20');
}

function collectUrlTargets(catalog: {
  platform: string;
  products: Array<{
    link?: TrackedString;
    images: Array<{ url: TrackedString }>;
    variants: Array<{ link?: TrackedString; image?: TrackedString }>;
  }>;
}): UrlCheckTarget[] {
  const byCell = new Map<string, UrlCheckTarget>();

  const add = (tracked: TrackedString | undefined, isCommaList: boolean) => {
    if (!tracked) return;
    const key = `${tracked.ref.row}:${tracked.ref.col}`;
    if (!byCell.has(key)) {
      byCell.set(key, { tracked, isCommaList });
    }
  };

  const isWooImages = catalog.platform === 'woocommerce';
  for (const product of catalog.products) {
    add(product.link, false);
    for (const img of product.images) {
      const colLower = img.url.ref.columnName.toLowerCase();
      const commaList =
        isWooImages ||
        colLower.includes('additional_image_link') ||
        colLower.includes('additional image link');
      add(img.url, commaList);
    }
    for (const variant of product.variants) {
      add(variant.link, false);
      add(variant.image, isWooImages);
    }
  }

  return [...byCell.values()];
}

function extractUrls(target: UrlCheckTarget): string[] {
  const raw = target.tracked.ref.raw;
  if (!target.isCommaList) {
    const t = raw.trim();
    return t ? [t] : [];
  }
  return raw
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

export const linksInvalidUrlRule: RuleRunner = {
  meta: {
    id: 'links.invalid-url',
    group: 'links',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Relative or broken link',
    explanation:
      'Product and image URLs must be full web addresses starting with https:// or http://.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const target of collectUrlTargets(catalog)) {
      const urls = extractUrls(target);
      for (const u of urls) {
        // Test with spaces encoded so a valid URL that only has spaces is handled by links.spaces-in-url
        const testCandidate = encodeSpacesInUrl(u);
        if (!isValidAbsoluteHttpUrl(testCandidate)) {
          problems.push({
            id: createProblemId(
              'links.invalid-url',
              target.tracked.ref.row,
              target.tracked.ref.col,
            ),
            ruleId: 'links.invalid-url',
            group: 'links',
            severity: 'fail',
            title: 'Relative or broken link',
            message: `Link "${u}" is not a full valid URL (must start with https:// or http://).`,
            row: target.tracked.ref.row,
            col: target.tracked.ref.col,
            columnName: target.tracked.ref.columnName,
            rawValue: target.tracked.ref.raw,
          });
          break;
        }
      }
    }
    return problems;
  },
};

export const linksSpacesInUrlRule: RuleRunner = {
  meta: {
    id: 'links.spaces-in-url',
    group: 'links',
    severity: 'fail',
    platforms: ALL_PLATFORMS,
    title: 'Link has spaces in it',
    explanation: 'Unencoded spaces inside URLs break image downloads and product links.',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const target of collectUrlTargets(catalog)) {
      const urls = extractUrls(target);
      const hasSpacesInsideUrl = urls.some((u) => {
        if (!u.includes(' ')) return false;
        return isValidAbsoluteHttpUrl(encodeSpacesInUrl(u));
      });
      if (!hasSpacesInsideUrl) continue;

      const fixedCell = target.isCommaList
        ? urls.map((u) => (u.includes(' ') ? encodeSpacesInUrl(u) : u)).join(', ')
        : encodeSpacesInUrl(urls[0]);

      problems.push({
        id: createProblemId('links.spaces-in-url', target.tracked.ref.row, target.tracked.ref.col),
        ruleId: 'links.spaces-in-url',
        group: 'links',
        severity: 'fail',
        title: 'Link has spaces in it',
        message: `Link contains unencoded spaces: "${target.tracked.ref.raw}"`,
        row: target.tracked.ref.row,
        col: target.tracked.ref.col,
        columnName: target.tracked.ref.columnName,
        rawValue: target.tracked.ref.raw,
        fix: {
          safe: true,
          description: 'Encode spaces in URL as %20',
          edits: [
            {
              row: target.tracked.ref.row,
              col: target.tracked.ref.col,
              columnName: target.tracked.ref.columnName,
              before: target.tracked.ref.raw,
              after: fixedCell,
            },
          ],
        },
      });
    }
    return problems;
  },
};

export const linksHttpUrlRule: RuleRunner = {
  meta: {
    id: 'links.http-url',
    group: 'links',
    severity: 'tip',
    platforms: ALL_PLATFORMS,
    title: 'Link uses http:// instead of https://',
    explanation:
      'HTTPS links are recommended across platforms. FeedFix never rewrites http:// automatically in case the host does not support TLS.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];
    for (const target of collectUrlTargets(catalog)) {
      const urls = extractUrls(target);
      const httpUrl = urls.find(
        (u) => /^http:\/\//i.test(u) && isValidAbsoluteHttpUrl(encodeSpacesInUrl(u)),
      );
      if (!httpUrl) continue;

      problems.push({
        id: createProblemId('links.http-url', target.tracked.ref.row, target.tracked.ref.col),
        ruleId: 'links.http-url',
        group: 'links',
        severity: 'tip',
        title: 'Link uses http:// instead of https://',
        message: `Link uses plain http:// instead of https://: "${httpUrl}"`,
        row: target.tracked.ref.row,
        col: target.tracked.ref.col,
        columnName: target.tracked.ref.columnName,
        rawValue: target.tracked.ref.raw,
      });
    }
    return problems;
  },
};

export const linksMissingImageRule: RuleRunner = {
  meta: {
    id: 'links.missing-image',
    group: 'links',
    severity: 'reject',
    platforms: ['shopify', 'woocommerce', 'other'],
    title: 'Product has no image link',
    explanation: 'Products without an image look incomplete on storefronts and fail channel feeds.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    // Google missing image_link is already flagged as a required field failure.
    if (catalog.platform === 'google') return [];
    const imageCol =
      catalog.platform === 'shopify'
        ? catalog.columnMap.imageSrc
        : catalog.platform === 'woocommerce'
          ? catalog.columnMap.images
          : catalog.columnMap.image;
    if (imageCol === undefined) return [];

    const problems: Problem[] = [];
    for (const product of catalog.products) {
      const hasImage = product.images.length > 0 || product.variants.some((v) => Boolean(v.image));
      if (hasImage) continue;

      problems.push({
        id: createProblemId('links.missing-image', product.sourceRow, imageCol),
        ruleId: 'links.missing-image',
        group: 'links',
        severity: 'reject',
        title: 'Product has no image link',
        message: `Product "${
          product.title?.value ?? product.handle?.value ?? `row ${product.sourceRow}`
        }" has no image URL.`,
        row: product.sourceRow,
        col: imageCol,
        columnName: catalog.headers[imageCol] ?? 'Image',
      });
    }
    return problems;
  },
};

export const LINK_RULES: RuleRunner[] = [
  linksInvalidUrlRule,
  linksSpacesInUrlRule,
  linksHttpUrlRule,
  linksMissingImageRule,
];
