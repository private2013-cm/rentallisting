// Zillow-only rental scraper. Strict photo whitelist, fast parallel fetches.
// Photos: only the main listing gallery photos (photos.zillowstatic.com/fp/...).

export interface ScrapedListing {
  source: "zillow";
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

export function detectSource(_url: string): "zillow" { return "zillow"; }

// Zillow gallery photos only — exclude "similar listings" / map / agent assets
const ZILLOW_PHOTO_RE = /https:\/\/photos\.zillowstatic\.com\/fp\/[a-zA-Z0-9_-]+(?:-uncropped_scaled_within_\d+_\d+|-cc_ft_\d+)?\.(?:jpg|webp|jpeg)/gi;

function fingerprint(u: string): string {
  return u
    .replace(/-uncropped_scaled_within_\d+_\d+/i, "")
    .replace(/-cc_ft_\d+/i, "")
    .replace(/\d{2,4}x\d{2,4}/i, "")
    .replace(/\.(jpg|jpeg|webp)$/i, "");
}
function widthOf(s: string): number {
  return Number(
    s.match(/_within_(\d+)_/)?.[1] ??
    s.match(/-cc_ft_(\d+)/)?.[1] ??
    s.match(/(\d{3,4})x\d{3,4}/)?.[1] ?? 0
  );
}
function dedupeKeepLargest(urls: string[]): string[] {
  const map = new Map<string, string>();
  for (const u of urls) {
    const fp = fingerprint(u);
    const prev = map.get(fp);
    if (!prev || widthOf(u) > widthOf(prev)) map.set(fp, u);
  }
  return Array.from(map.values());
}

// Pull the **gallery** photos. Zillow embeds them in __NEXT_DATA__ JSON
// inside `responsivePhotos`/`hugePhotos`/`originalPhotos` arrays — those
// are the ones shown in the "1/N" carousel at the top.
function extractGalleryPhotos(html: string, markdown: string): string[] {
  const collected: string[] = [];

  // 1) Try the JSON blob first — gives us only the main carousel photos.
  const jsonMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (jsonMatch) {
    try {
      // Pull every photos.zillowstatic.com URL from the embedded JSON.
      const blob = jsonMatch[1];
      const inJson = blob.match(ZILLOW_PHOTO_RE) ?? [];
      // Filter to ones likely to be "responsive/huge" gallery sizes
      const big = inJson.filter(u => /_within_(\d{3,4})_/.test(u) || /-cc_ft_\d{3,4}/.test(u));
      collected.push(...(big.length ? big : inJson));
    } catch (_) { /* fall through */ }
  }

  // 2) Fallback to scanning whole markdown/html
  if (collected.length === 0) {
    collected.push(...(markdown.match(ZILLOW_PHOTO_RE) ?? []));
    collected.push(...(html.match(ZILLOW_PHOTO_RE) ?? []));
  }

  return dedupeKeepLargest(uniq(collected));
}

function parsePrice(text: string): number | null {
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
  const m = text.match(/\b(Single Family|Apartment|Condo|Condominium|Townhouse|Townhome|House|Manufactured|Multi[- ]?Family|Duplex|Studio)\b/i);
  if (!m) return null;
  const v = m[1].toLowerCase();
  if (v.includes("condo")) return "condo";
  if (v.includes("apart") || v.includes("multi") || v.includes("duplex") || v.includes("studio")) return "apartment";
  if (v.includes("town")) return "townhouse";
  return "house";
}

export function draftFromUrl(url: string): ScrapedListing {
  const clean = decodeURIComponent(url);
  const slugPart = clean.match(/homedetails\/([^/]+)\//i)?.[1] ?? "";
  let address: string | null = slugPart.replace(/\d+_zpid.*/i, "").replace(/-/g, " ").replace(/\s+/g, " ").trim() || null;
  if (address) address = address.replace(/\b([A-Z]{2})\s+(\d{5}(?: \d{4})?)$/i, "$1 $2");
  return {
    source: "zillow", source_url: url,
    address: address || "Address pending",
    price: null, beds: null, baths: null, sqft: null, property_type: null,
    description: "Link saved — couldn't fetch details automatically. Edit it on the admin page.",
    photos: [],
  };
}

export async function scrapeListing(url: string): Promise<ScrapedListing> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return draftFromUrl(url);
  try {
    const res = await fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown", "html"],
        onlyMainContent: false,
        waitFor: 2500,
      }),
    });
    if (!res.ok) {
      console.log(`Firecrawl ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return draftFromUrl(url);
    }
    const json = await res.json();
    const data = json?.data ?? json;
    const markdown: string = data?.markdown ?? "";
    const html: string = data?.html ?? data?.rawHtml ?? "";
    const meta = data?.metadata ?? {};

    const photos = extractGalleryPhotos(html, markdown);
    const bedsMatch = markdown.match(/(\d+(?:\.\d+)?)\s*(?:bd|beds?|bedrooms?)/i);
    const bathsMatch = markdown.match(/(\d+(?:\.\d+)?)\s*(?:ba|baths?|bathrooms?)/i);
    const sqftMatch = markdown.match(/([\d,]+)\s*(?:sqft|sq\.?\s*ft)/i);

    let address = parseAddress(markdown);
    if (!address && meta?.title) address = String(meta.title).split("|")[0].trim();
    let description = parseDescription(markdown);
    if (!description && meta?.description) description = String(meta.description);

    const result: ScrapedListing = {
      source: "zillow", source_url: url, address,
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

export const scrapeZillow = scrapeListing;

// ---- Search Zillow rentals ----
export interface SearchFilters {
  zip: string;
  beds: "any" | string;
  baths: "any" | string;
  types: string[];
  limit?: number;
}

export async function searchRentals(filters: SearchFilters): Promise<string[]> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return [];
  const limit = Math.min(Math.max(filters.limit ?? 8, 1), 40);

  const typeStr = filters.types.includes("any") || filters.types.length === 0
    ? ""
    : ` ${filters.types.join(" or ")}`;
  const bedStr = filters.beds === "any" ? "" : ` ${filters.beds} bedroom`;
  const bathStr = filters.baths === "any" ? "" : ` ${filters.baths} bath`;

  // Run multiple Zillow-targeted queries in parallel for breadth
  const queries = [
    `site:zillow.com/homedetails rent ${filters.zip}${bedStr}${bathStr}${typeStr}`,
    `site:zillow.com "for rent" ${filters.zip}${bedStr}${typeStr}`,
    `zillow.com homedetails ${filters.zip} for rent${bedStr}${typeStr}`,
  ];

  const collect = async (query: string): Promise<string[]> => {
    try {
      const res = await fetch(FIRECRAWL_SEARCH, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: Math.min(limit + 5, 25) }),
      });
      if (!res.ok) {
        console.log(`Firecrawl search ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return [];
      }
      const json = await res.json();
      // v2 returns { data: { web: [...] } } OR { data: [...] }
      const items = json?.data?.web ?? json?.data ?? json?.results?.web ?? [];
      return items.map((r: any) => r.url ?? r.link).filter((u: any) => typeof u === "string");
    } catch (e) {
      console.log("search err", (e as Error).message);
      return [];
    }
  };

  const all = (await Promise.all(queries.map(collect))).flat();
  // Strict: only Zillow homedetails pages
  const isDetail = (u: string) => /zillow\.com\/homedetails\//i.test(u);
  return uniq(all.filter(isDetail)).slice(0, limit);
}
