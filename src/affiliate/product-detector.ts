// ============================================
// ScreenAI — Product Detector (Affiliate Links - Phase 5)
// ============================================
// After AI analysis of a screenshot, detect if the response mentions
// an identifiable product. If so, suggest a discreet "Find this product online" button.
// Non-intrusive: optional suggestion, never forced.
// Transparent: "affiliate link" mention visible.

import { getSupabase } from '../auth/supabase';

export interface AffiliateConfig {
  partner: string;
  tag: string;
  urlTemplate: string;
  enabled: boolean;
}

export interface DetectedProduct {
  name: string;
  category: string;
  affiliateUrl: string;
  partner: string;
}

// Common product keywords that suggest a purchasable item
const PRODUCT_INDICATORS = [
  // Tech
  /(?:macbook|iphone|ipad|samsung|pixel|airpods|headphones|monitor|keyboard|mouse|laptop|tablet)/i,
  // Software
  /(?:subscription|license|pro plan|premium|upgrade to)/i,
  // Fashion
  /(?:sneakers|shoes|dress|jacket|watch|bag|sunglasses)/i,
  // Home
  /(?:chair|desk|lamp|stand|mount|cable|adapter|charger)/i,
  // Books
  /(?:book|guide|course|tutorial|ebook)/i,
];

const DEFAULT_CONFIGS: AffiliateConfig[] = [
  {
    partner: 'Amazon',
    tag: 'screenai-20',
    urlTemplate: 'https://www.amazon.com/s?k={query}&tag={tag}',
    enabled: true,
  },
];

let cachedConfigs: AffiliateConfig[] | null = null;

export class ProductDetector {
  async detect(aiResponse: string): Promise<DetectedProduct | null> {
    // Check if any product indicator matches
    const match = PRODUCT_INDICATORS.find(regex => regex.test(aiResponse));
    if (!match) return null;

    // Extract the product name from the match
    const result = match.exec(aiResponse);
    if (!result) return null;

    const productName = result[0];
    const configs = await this.getConfigs();
    const config = configs.find(c => c.enabled);
    if (!config) return null;

    const affiliateUrl = config.urlTemplate
      .replace('{query}', encodeURIComponent(productName))
      .replace('{tag}', config.tag);

    return {
      name: productName,
      category: 'product',
      affiliateUrl,
      partner: config.partner,
    };
  }

  private async getConfigs(): Promise<AffiliateConfig[]> {
    if (cachedConfigs) return cachedConfigs;

    // Try to load from Supabase
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data } = await supabase
          .from('affiliate_config')
          .select('*')
          .eq('enabled', true);

        if (data && data.length > 0) {
          cachedConfigs = data.map((d: any) => ({
            partner: d.partner,
            tag: d.tag,
            urlTemplate: d.url_template,
            enabled: d.enabled,
          }));
          return cachedConfigs;
        }
      } catch {}
    }

    // Fallback to defaults
    cachedConfigs = DEFAULT_CONFIGS;
    return cachedConfigs;
  }

  renderSuggestion(product: DetectedProduct): string {
    return `
      <div class="affiliate-suggestion" style="
        margin-top:8px;
        padding:8px 12px;
        background:var(--acbg);
        border:1px solid var(--acbg2);
        border-radius:8px;
        font-size:11px;
        display:flex;
        align-items:center;
        gap:8px;
      ">
        <a href="${product.affiliateUrl}" target="_blank" rel="noopener" style="
          color:var(--ac);
          text-decoration:none;
          font-weight:500;
        ">
          Find "${product.name}" online
        </a>
        <span style="color:var(--t3);font-size:9px">affiliate link</span>
      </div>
    `;
  }
}

export const productDetector = new ProductDetector();
