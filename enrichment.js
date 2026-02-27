// enrichment.js — Company enrichment engine
// Scrapes a domain's public website and extracts structured company data
// No external paid APIs needed — uses free public data sources only

import * as cheerio from 'cheerio';
import { promises as dns } from 'dns';

// ============================================
// MAIN ENRICHMENT FUNCTION
// ============================================

/**
 * Enrich a domain with company data.
 * Fetches homepage + about page, extracts structured info.
 * 
 * @param {string} domain — e.g., "stripe.com"
 * @returns {object} — structured company data
 */
export async function enrichDomain(domain) {
  // Normalize domain
  domain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '');

  const startTime = Date.now();

  // Run all data collection in parallel for speed
  const [homepageData, aboutData, dnsData, techStack] = await Promise.allSettled([
    fetchAndParse(`https://${domain}`),
    fetchAndParse(`https://${domain}/about`).catch(() =>
      fetchAndParse(`https://${domain}/about-us`).catch(() => null)
    ),
    getDnsData(domain),
    detectTechStack(domain),
  ]);

  const homepage = homepageData.status === 'fulfilled' ? homepageData.value : null;
  const about = aboutData.status === 'fulfilled' ? aboutData.value : null;
  const dnsInfo = dnsData.status === 'fulfilled' ? dnsData.value : {};
  const tech = techStack.status === 'fulfilled' ? techStack.value : [];

  if (!homepage) {
    return {
      domain,
      status: 'error',
      error: `Could not reach ${domain}`,
      timestamp: new Date().toISOString(),
    };
  }

  // Extract and merge data from all sources
  const result = {
    domain,
    status: 'success',
    company: {
      name: extractCompanyName(homepage, about, domain),
      description: extractDescription(homepage, about),
      industry: inferIndustry(homepage, about),
    },
    location: extractLocation(homepage, about),
    social: extractSocialLinks(homepage, about),
    tech_stack: tech,
    dns: dnsInfo,
    meta: {
      title: homepage?.title || null,
      favicon: homepage?.favicon ? `https://${domain}${homepage.favicon}` : null,
      language: homepage?.language || null,
      has_about_page: about !== null,
    },
    enriched_at: new Date().toISOString(),
    processing_ms: Date.now() - startTime,
  };

  return result;
}

// ============================================
// WEB FETCHING
// ============================================

/**
 * Fetch a URL and parse it with Cheerio.
 * Returns structured data extracted from the HTML.
 */
async function fetchAndParse(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'CompanyEnrichBot/1.0 (enrichment service)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove script and style tags to clean up text extraction
    $('script, style, noscript, iframe').remove();

    return {
      $,
      html,
      url: response.url, // Final URL after redirects
      title: $('title').first().text().trim() || null,
      favicon: $('link[rel*="icon"]').first().attr('href') || null,
      language: $('html').attr('lang') || null,
      metaDescription: $('meta[name="description"]').attr('content')
        || $('meta[property="og:description"]').attr('content')
        || null,
      metaKeywords: $('meta[name="keywords"]').attr('content') || null,
      ogTitle: $('meta[property="og:title"]').attr('content') || null,
      ogImage: $('meta[property="og:image"]').attr('content') || null,
      bodyText: $('body').text().replace(/\s+/g, ' ').trim().slice(0, 5000),
      headings: $('h1, h2').map((_, el) => $(el).text().trim()).get().slice(0, 10),
      links: $('a[href]').map((_, el) => ({
        href: $(el).attr('href'),
        text: $(el).text().trim(),
      })).get(),
    };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================
// DATA EXTRACTION
// ============================================

/**
 * Extract company name from page data.
 * Tries multiple sources in order of reliability.
 */
function extractCompanyName(homepage, about, domain) {
  // 1. Try og:title or site name meta
  const ogSiteName = homepage?.$?.('meta[property="og:site_name"]').attr('content');
  if (ogSiteName) return ogSiteName.trim();

  // 2. Try structured data (JSON-LD)
  const jsonLd = extractJsonLd(homepage);
  if (jsonLd?.name) return jsonLd.name;

  // 3. Try page title, cleaned up
  if (homepage?.title) {
    // Remove common suffixes like " - Home", " | Official Site"
    const cleaned = homepage.title
      .split(/\s*[|\-–—:]\s*/)[0]
      .trim();
    if (cleaned.length > 1 && cleaned.length < 60) return cleaned;
  }

  // 4. Fall back to domain name, capitalized
  return domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
}

/**
 * Extract company description.
 */
function extractDescription(homepage, about) {
  // 1. Meta description is usually the best short summary
  if (homepage?.metaDescription) return homepage.metaDescription.trim();

  // 2. Try about page meta description
  if (about?.metaDescription) return about.metaDescription.trim();

  // 3. Try JSON-LD description
  const jsonLd = extractJsonLd(homepage);
  if (jsonLd?.description) return jsonLd.description;

  // 4. Try first meaningful paragraph from about page
  if (about?.$) {
    const firstP = about.$('main p, article p, .about p, #about p, p')
      .filter((_, el) => about.$(el).text().trim().length > 50)
      .first()
      .text()
      .trim();
    if (firstP) return firstP.slice(0, 300);
  }

  return null;
}

/**
 * Infer industry from page content.
 */
function inferIndustry(homepage, about) {
  const text = [
    homepage?.metaDescription,
    homepage?.metaKeywords,
    homepage?.title,
    about?.metaDescription,
  ].filter(Boolean).join(' ').toLowerCase();

  const industries = [
    { keywords: ['fintech', 'payment', 'banking', 'financial', 'finance', 'lending', 'insurance'], label: 'Financial Technology' },
    { keywords: ['saas', 'software', 'platform', 'cloud', 'devops', 'api'], label: 'Software / SaaS' },
    { keywords: ['ecommerce', 'e-commerce', 'shop', 'retail', 'store', 'marketplace'], label: 'E-Commerce / Retail' },
    { keywords: ['health', 'medical', 'healthcare', 'biotech', 'pharma', 'clinical'], label: 'Healthcare / Biotech' },
    { keywords: ['education', 'learning', 'edtech', 'course', 'university', 'school'], label: 'Education' },
    { keywords: ['real estate', 'property', 'proptech', 'housing', 'mortgage'], label: 'Real Estate' },
    { keywords: ['ai', 'artificial intelligence', 'machine learning', 'ml', 'deep learning'], label: 'Artificial Intelligence' },
    { keywords: ['crypto', 'blockchain', 'web3', 'defi', 'nft', 'token'], label: 'Blockchain / Crypto' },
    { keywords: ['media', 'news', 'content', 'publish', 'journal', 'blog'], label: 'Media / Publishing' },
    { keywords: ['security', 'cybersecurity', 'infosec', 'privacy', 'encryption'], label: 'Cybersecurity' },
    { keywords: ['food', 'restaurant', 'delivery', 'recipe', 'dining'], label: 'Food & Beverage' },
    { keywords: ['travel', 'hotel', 'flight', 'booking', 'tourism'], label: 'Travel & Hospitality' },
    { keywords: ['gaming', 'game', 'esports', 'play'], label: 'Gaming' },
    { keywords: ['marketing', 'advertising', 'seo', 'crm', 'analytics'], label: 'Marketing / AdTech' },
    { keywords: ['logistics', 'shipping', 'supply chain', 'freight', 'warehouse'], label: 'Logistics / Supply Chain' },
    { keywords: ['energy', 'solar', 'renewable', 'cleantech', 'electric'], label: 'Energy / CleanTech' },
    { keywords: ['legal', 'law', 'compliance', 'attorney', 'legaltech'], label: 'Legal Tech' },
    { keywords: ['hr', 'hiring', 'recruit', 'talent', 'workforce', 'payroll'], label: 'HR / Recruiting' },
    { keywords: ['construction', 'building', 'architecture', 'contractor'], label: 'Construction' },
    { keywords: ['automotive', 'car', 'vehicle', 'ev', 'driving'], label: 'Automotive' },
  ];

  let bestMatch = null;
  let bestScore = 0;

  for (const industry of industries) {
    const score = industry.keywords.filter(kw => text.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = industry.label;
    }
  }

  return bestMatch || 'Technology';
}

/**
 * Extract location/address info.
 */
function extractLocation(homepage, about) {
  // Try JSON-LD first
  const jsonLd = extractJsonLd(homepage);
  if (jsonLd?.address) {
    const addr = jsonLd.address;
    return {
      address: addr.streetAddress || null,
      city: addr.addressLocality || null,
      state: addr.addressRegion || null,
      country: addr.addressCountry || null,
      postal_code: addr.postalCode || null,
    };
  }

  // Try geo meta tags
  const geoRegion = homepage?.$?.('meta[name="geo.region"]').attr('content');
  const geoPlace = homepage?.$?.('meta[name="geo.placename"]').attr('content');

  if (geoRegion || geoPlace) {
    return {
      address: null,
      city: geoPlace || null,
      state: geoRegion || null,
      country: null,
      postal_code: null,
    };
  }

  return null;
}

/**
 * Extract social media links from all pages.
 */
function extractSocialLinks(homepage, about) {
  const allLinks = [...(homepage?.links || []), ...(about?.links || [])];

  const social = {};
  const patterns = {
    twitter: /(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/,
    linkedin: /linkedin\.com\/(?:company|in)\/([a-zA-Z0-9_-]+)/,
    github: /github\.com\/([a-zA-Z0-9_-]+)/,
    facebook: /facebook\.com\/([a-zA-Z0-9._-]+)/,
    instagram: /instagram\.com\/([a-zA-Z0-9._-]+)/,
    youtube: /youtube\.com\/(?:@|channel\/|c\/)?([a-zA-Z0-9_-]+)/,
  };

  for (const link of allLinks) {
    const href = link.href || '';
    for (const [platform, regex] of Object.entries(patterns)) {
      if (!social[platform] && regex.test(href)) {
        social[platform] = href.startsWith('http') ? href : `https://${href}`;
      }
    }
  }

  return Object.keys(social).length > 0 ? social : null;
}

// ============================================
// TECH STACK DETECTION
// ============================================

/**
 * Detect technologies used by the website.
 * Analyzes HTTP headers, HTML content, and script sources.
 */
async function detectTechStack(domain) {
  const techs = [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`https://${domain}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CompanyEnrichBot/1.0' },
    });

    clearTimeout(timeout);

    const headers = Object.fromEntries(response.headers.entries());
    const html = await response.text();
    const htmlLower = html.toLowerCase();

    // Server headers
    if (headers['server']?.includes('nginx')) techs.push('Nginx');
    if (headers['server']?.includes('apache')) techs.push('Apache');
    if (headers['server']?.includes('cloudflare')) techs.push('Cloudflare');
    if (headers['x-powered-by']?.includes('Express')) techs.push('Express.js');
    if (headers['x-powered-by']?.includes('Next.js')) techs.push('Next.js');
    if (headers['x-powered-by']?.includes('PHP')) techs.push('PHP');
    if (headers['cf-ray']) techs.push('Cloudflare');
    if (headers['x-vercel-id'] || headers['x-vercel-cache']) techs.push('Vercel');
    if (headers['x-amz-cf-id'] || headers['x-amz-request-id']) techs.push('AWS');

    // HTML meta generators
    const generatorMatch = html.match(/<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i);
    if (generatorMatch) techs.push(generatorMatch[1]);

    // JavaScript frameworks (check script sources and inline patterns)
    if (htmlLower.includes('react') || htmlLower.includes('_next') || htmlLower.includes('__next')) techs.push('React');
    if (htmlLower.includes('vue.js') || htmlLower.includes('vue.min.js') || html.includes('__vue')) techs.push('Vue.js');
    if (htmlLower.includes('angular') || html.includes('ng-version')) techs.push('Angular');
    if (htmlLower.includes('svelte')) techs.push('Svelte');
    if (html.includes('_next/static') || html.includes('__NEXT_DATA__')) techs.push('Next.js');
    if (html.includes('gatsby')) techs.push('Gatsby');
    if (html.includes('nuxt') || html.includes('__NUXT__')) techs.push('Nuxt.js');

    // CSS frameworks
    if (htmlLower.includes('tailwind') || html.includes('tw-')) techs.push('Tailwind CSS');
    if (htmlLower.includes('bootstrap')) techs.push('Bootstrap');

    // Analytics & tracking
    if (html.includes('google-analytics') || html.includes('gtag') || html.includes('GA_TRACKING')) techs.push('Google Analytics');
    if (html.includes('googletagmanager')) techs.push('Google Tag Manager');
    if (html.includes('hotjar')) techs.push('Hotjar');
    if (html.includes('segment.com') || html.includes('analytics.js')) techs.push('Segment');
    if (html.includes('hubspot')) techs.push('HubSpot');
    if (html.includes('intercom')) techs.push('Intercom');
    if (html.includes('drift')) techs.push('Drift');
    if (html.includes('zendesk')) techs.push('Zendesk');

    // CMS
    if (html.includes('wp-content') || html.includes('wp-includes')) techs.push('WordPress');
    if (html.includes('Shopify') || html.includes('shopify')) techs.push('Shopify');
    if (html.includes('squarespace')) techs.push('Squarespace');
    if (html.includes('wix.com')) techs.push('Wix');
    if (html.includes('webflow')) techs.push('Webflow');
    if (html.includes('ghost')) techs.push('Ghost');

    // CDNs
    if (html.includes('cdn.jsdelivr.net')) techs.push('jsDelivr CDN');
    if (html.includes('cdnjs.cloudflare.com')) techs.push('cdnjs');
    if (html.includes('unpkg.com')) techs.push('unpkg');
    if (html.includes('fastly')) techs.push('Fastly');

    // Payment
    if (html.includes('stripe') && html.includes('js.stripe.com')) techs.push('Stripe');
    if (html.includes('paypal')) techs.push('PayPal');

  } catch (err) {
    // Silent fail — tech detection is best-effort
  }

  // Deduplicate
  return [...new Set(techs)];
}

// ============================================
// DNS DATA
// ============================================

/**
 * Get DNS-level information about the domain.
 */
async function getDnsData(domain) {
  const result = {};

  try {
    const mxRecords = await dns.resolveMx(domain).catch(() => []);
    if (mxRecords.length > 0) {
      result.mail_provider = inferMailProvider(mxRecords);
      result.mx_records = mxRecords.map(r => r.exchange).slice(0, 3);
    }
  } catch (err) { /* silent */ }

  try {
    const txtRecords = await dns.resolveTxt(domain).catch(() => []);
    const flat = txtRecords.flat();
    result.has_spf = flat.some(r => r.includes('v=spf1'));
    result.has_dmarc = false;
    try {
      const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`).catch(() => []);
      result.has_dmarc = dmarcRecords.flat().some(r => r.includes('v=DMARC1'));
    } catch (err) { /* silent */ }

    // Check for common verification TXT records
    result.verified_services = [];
    for (const record of flat) {
      if (record.includes('google-site-verification')) result.verified_services.push('Google');
      if (record.includes('facebook-domain-verification')) result.verified_services.push('Facebook');
      if (record.includes('MS=')) result.verified_services.push('Microsoft');
      if (record.includes('atlassian-domain-verification')) result.verified_services.push('Atlassian');
      if (record.includes('docusign')) result.verified_services.push('DocuSign');
    }
  } catch (err) { /* silent */ }

  return result;
}

/**
 * Infer email provider from MX records.
 */
function inferMailProvider(mxRecords) {
  const exchanges = mxRecords.map(r => r.exchange.toLowerCase());
  const joined = exchanges.join(' ');

  if (joined.includes('google') || joined.includes('gmail')) return 'Google Workspace';
  if (joined.includes('outlook') || joined.includes('microsoft')) return 'Microsoft 365';
  if (joined.includes('mimecast')) return 'Mimecast';
  if (joined.includes('protonmail') || joined.includes('proton')) return 'Proton Mail';
  if (joined.includes('zoho')) return 'Zoho Mail';
  if (joined.includes('fastmail')) return 'Fastmail';
  if (joined.includes('icloud') || joined.includes('apple')) return 'Apple iCloud';
  if (joined.includes('amazonaws') || joined.includes('ses')) return 'Amazon SES';
  if (joined.includes('sendgrid')) return 'SendGrid';
  if (joined.includes('postmark')) return 'Postmark';

  return 'Other';
}

// ============================================
// HELPERS
// ============================================

/**
 * Try to extract JSON-LD structured data from a page.
 */
function extractJsonLd(pageData) {
  if (!pageData?.$) return null;

  try {
    const scripts = pageData.$('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
      const text = pageData.$(scripts[i]).html();
      if (!text) continue;

      const data = JSON.parse(text);

      // Handle arrays of JSON-LD objects
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Organization' || item['@type'] === 'Corporation'
          || item['@type'] === 'LocalBusiness' || item['@type'] === 'Company') {
          return item;
        }
      }
    }
  } catch (err) {
    // JSON-LD parsing is best-effort
  }

  return null;
}
