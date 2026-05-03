// Multi-source rental scraper — Zillow, Redfin, Trulia, Realtor.
// Strict photo filtering: only photos hosted on each portal's listing-photo CDN are kept.
// Other images on the page (ads, "similar listings", agent headshots, map tiles) are dropped.

export interface ScrapedListing {
  source: "zillow" | "redfin" | "trulia" | "realtor" | "other";
  source_url: string;
  address: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  property_type: string | null;
  description: string | null;
  photos: string[];
}

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_SEARCH = "https://api.firecrawl.dev/v2/search";

function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }

// ---- Source detection ----
export function detectSource(url: string): ScrapedListing["source"] {
  const u = url.toLowerCase();
  if (u.includes("zillow.com")) return "zillow";
  if (u.includes("redfin.com")) return "redfin";
  if (u.includes("trulia.com")) return "trulia";
  if (u.includes("realtor.com")) return "realtor";
  return "other";
}

// ---- Per-source photo filters (strict whitelist) ----
// Each pattern matches only the listing-photo CDN of that portal.
const PHOTO_PATTERNS: Record<string, RegExp> = {
  zillow:  /https:\/\/photos\.zillowstatic\.com\/fp\/[a-zA-Z0-9_-]+(?:-uncropped_scaled_within_\d+_\d+|-cc_ft_\d+)?\.(?:jpg|webp|jpeg)/gi,
  redfin:  /https:\/\/ssl\.cdn-redfin\.com\/photo\/[^\s"'<>)]+\.(?:jpg|webp|jpeg)/gi,
  trulia:  /https:\/\/www\.trulia\.com\/pictures\/[^\s"'<>)]+\.(?:jpg|webp|jpeg)/gi,
  realtor: /https:\/\/ap\.rdcpix\.com\/[^\s"'<>)]+\.(?:jpg|webp|jpeg)/gi,
};

// Zillow serves the same photo at many sizes — fingerprint to dedupe.
function fingerprint(u: string): string {
  return u
    .replace(/-uncropped_scaled_within_\d+_\d+/i, "")
    .replace(/-cc_ft_\d+/i, "")
    .replace(/\d{2,4}x\d{2,4}/i, "")
    .replace(/\.(jpg|jpeg|webp)$/i, "");
}
function dedupe(urls: string[]): string[] {
  const map = new Map<string, string>();
  const widthOf = (s: string) =>
    Number(s.match(/_within_(\d+)_/)?.[1] ?? s.match(/-cc_ft_(\d+)/)?.[1] ?? s.match(/(\d{3,4})x\d{3,4}/)?.[1] ?? 0);
  for (const u of urls) {
    const fp = fingerprint(u);
    const prev = map.get(fp);
    if (!prev || widthOf(u) > widthOf(prev)) map.set(fp, u);
  }
  return Array.from(map.values());
}

function extractPhotos(source: string, markdown: string, html: string): string[] {
  const re = PHOTO_PATTERNS[source];
  if (!re) return [];
  const all = uniq([...(markdown.match(re) ?? []), ...(html.match(re) ?? [])]);
  return dedupe(all);
}

// ---- Generic field parsers ----
function parsePrice(text: string): number | null {
  // Look near $ before "/mo" or "per month" first
  const m1 = text.match(/\$\s*([\d,]+)\s*(?:\/\s*mo|per\s*month|monthly)/i);
  if (m1) {
    const n = parseInt(m1[1].replace(/,/g, ""), 10);
    if (!isNaN(n) && n > 100 && n < 100000) return n;
  }
  const m2 = text.match(/\$\s*([\d,]+)/);
  if (m2) {
    const n = parseInt(m2[1].replace(/,/g, ""), 10);
    if (!isNaN(n) && n > 100 && n < 100000) return n;
  }
  return null;
}

function parseAddress(text: string): string | null {
  const m = text.match(/\d{1,6}\s+[A-Z][\w\s.\-']+,\s*[A-Z][\w\s\-']+,\s*[A-Z]{2}\s*\d{5}/);
  return m ? m[0] : null;
}

function parseDescription(text: string): string | null {
  const m = text.match(/(?:^|\n)#+\s*(?:Description|About|What's special|Overview|Property Details)[^\n]*\n+([\s\S]{60,1500}?)(?:\n#+|\n\n\n|$)/i);
  return m ? m[1].trim() : null;
}

function parsePropertyType(text: string): string | null {
  const m = text.match(/\b(Single Family|Apartment|Condo|Condominium|Townhouse|Townhome|House|Multi[- ]?Family|Duplex|Studio)\b/i);
  if (!m) return null;
  const v = m[1].toLowerCase();
  if (v.includes("condo")) return "condo";
  if (v.includes("apart") || v.includes("multi") || v.includes("duplex") || v.includes("studio")) return "apartment";
  if (v.includes("town")) return "townhouse";
  return "house";
}

// ---- Draft fallback ----
export function draftFromUrl(url: string): ScrapedListing {
  const source = detectSource(url);
  const clean = decodeURIComponent(url);
  let address: string | null = null;
  if (source === "zillow") {
    const slugPart = clean.match(/homedetails\/([^/]+)\//i)?.[1] ?? "";
    address = slugPart.replace(/\d+_zpid.*/i, "").replace(/-/g, " ").replace(/\s+/g, " ").trim() || null;
    if (address) address = address.replace(/\b([A-Z]{2})\s+(\d{5}(?: \d{4})?)$/i, "$1 $2");
  }
  return {
    source, source_url: url,
    address: address || "Address pending",
    price: null, beds: null, baths: null, sqft: null,
    property_type: null,
    description: "Link saved — couldn't fetch details (source may have blocked us). Edit on the admin page.",
    photos: [],
  };
}

// ---- Main scrape via Firecrawl ----
export async function scrapeListing(url: string): Promise<ScrapedListing> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) {
    console.log("FIRECRAWL_API_KEY not configured — using draft fallback");
    return draftFromUrl(url);
  }
  const source = detectSource(url);
  try {
    const res = await fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown", "html"],
        onlyMainContent: false,
        waitFor: source === "redfin" ? 3500 : 2500,
      }),
    });
    if (!res.ok) {
      console.log(`Firecrawl ${res.status} for ${source}: ${(await res.text()).slice(0, 200)}`);
      return draftFromUrl(url);
    }
    const json = await res.json();
    const data = json?.data ?? json;
    const markdown: string = data?.markdown ?? "";
    const html: string = data?.html ?? data?.rawHtml ?? "";
    const meta = data?.metadata ?? {};

    const photos = extractPhotos(source, markdown, html);
    const bedsMatch = markdown.match(/(\d+(?:\.\d+)?)\s*(?:bd|beds?|bedrooms?)/i);
    const bathsMatch = markdown.match(/(\d+(?:\.\d+)?)\s*(?:ba|baths?|bathrooms?)/i);
    const sqftMatch = markdown.match(/([\d,]+)\s*(?:sqft|sq\.?\s*ft)/i);

    let address = parseAddress(markdown);
    if (!address && meta?.title) address = String(meta.title).split("|")[0].trim();
    let description = parseDescription(markdown);
    if (!description && meta?.description) description = String(meta.description);

    const result: ScrapedListing = {
      source, source_url: url, address,
      price: parsePrice(markdown),
      beds: bedsMatch ? Number(bedsMatch[1]) : null,
      baths: bathsMatch ? Number(bathsMatch[1]) : null,
      sqft: sqftMatch ? Number(sqftMatch[1].replace(/,/g, "")) : null,
      property_type: parsePropertyType(markdown),
      description,
      photos,
    };
    if (photos.length === 0 && !result.price && !result.address) return draftFromUrl(url);
    return result;
  } catch (e) {
    console.log(`Scrape error: ${(e as Error).message}`);
    return draftFromUrl(url);
  }
}

// Backwards-compat exports
export const scrapeZillow = scrapeListing;

// ---- Search rentals via Firecrawl /search ----
// Returns candidate listing URLs from Zillow & Redfin matching filters.
export interface SearchFilters {
  zip: string;
  beds: "any" | string; // "3" or "3+"
  baths: "any" | string;
  types: string[]; // ["house","apartment","condo"] or ["any"]
  limit?: number;
}

export async function searchRentals(filters: SearchFilters): Promise<string[]> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return [];
  const limit = filters.limit ?? 8;
  const typeStr = filters.types.includes("any") || filters.types.length === 0
    ? ""
    : ` ${filters.types.join(" or ")}`;
  const bedStr = filters.beds === "any" ? "" : ` ${filters.beds} bed`;
  const bathStr = filters.baths === "any" ? "" : ` ${filters.baths} bath`;

  const q1 = `site:zillow.com rentals ${filters.zip}${bedStr}${bathStr}${typeStr}`;
  const q2 = `site:redfin.com rent ${filters.zip}${bedStr}${bathStr}${typeStr}`;

  const collect = async (query: string): Promise<string[]> => {
    try {
      const res = await fetch(FIRECRAWL_SEARCH, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit }),
      });
      if (!res.ok) return [];
      const json = await res.json();
      const items = json?.data ?? json?.results?.web ?? [];
      return items
        .map((r: any) => r.url ?? r.link)
        .filter((u: string) => typeof u === "string");
    } catch { return []; }
  };

  const [a, b] = await Promise.all([collect(q1), collect(q2)]);
  // Filter to actual listing detail pages, not search/index pages
  const isDetail = (u: string) =>
    /zillow\.com\/(homedetails|b)\//i.test(u) ||
    /redfin\.com\/(?:[A-Z]{2}|state)\/[\w-]+\/.+\/home\/\d+/i.test(u) ||
    /redfin\.com\/.+\/rental\//i.test(u);

  return uniq([...a, ...b].filter(isDetail)).slice(0, limit);
}
