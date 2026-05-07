// Zillow-only rental/sale scraper. Strict photo whitelist, fast parallel fetches.
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

export interface SearchResult {
  urls: string[];
  modeUsed: "rent" | "sale";
  fallbackUsed: boolean;
}

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_SEARCH = "https://api.firecrawl.dev/v2/search";

function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }

export function detectSource(_url: string): "zillow" { return "zillow"; }

const ZILLOW_PHOTO_RE = /https:\/\/photos\.zillowstatic\.com\/fp\/[a-zA-Z0-9_-]+(?:-uncropped_scaled_within_\d+_\d+|-cc_ft_\d+)?\.(?:jpg|webp|jpeg)/gi;
const BLOCKED_PHOTO_PATH_RE = /(aside|header|footer|recommend|recommended|similar|nearby|map|staticmap|upsell|ad|sponsor|thumb|thumbnail|logo|icon|brand|broker|agent)/i;
const GALLERY_PATH_RE = /(photo|photos|gallery|carousel|viewer|media|responsivePhotos|originalPhotos|hugePhotos|listing)/i;

type PhotoCandidate = { url: string; width: number; height: number };

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
function heightOf(s: string): number {
  return Number(
    s.match(/_within_\d+_(\d+)/)?.[1] ??
    s.match(/\d{3,4}x(\d{3,4})/)?.[1] ?? 0
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

function normalizePhotoUrl(url: string): string | null {
  const clean = url.split("?")[0].trim();
  return /^https:\/\/photos\.zillowstatic\.com\/fp\//i.test(clean) ? clean : null;
}

function candidateFromUrl(url: string, width?: number | null, height?: number | null): PhotoCandidate | null {
  const normalized = normalizePhotoUrl(url);
  if (!normalized) return null;
  const finalWidth = Math.max(Number(width ?? 0), widthOf(normalized));
  const finalHeight = Math.max(Number(height ?? 0), heightOf(normalized));
  if ((finalWidth && finalWidth < 600) || (finalHeight && finalHeight < 400)) return null;
  return { url: normalized, width: finalWidth, height: finalHeight };
}

function pickBestCandidate(candidates: PhotoCandidate[]): PhotoCandidate | null {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => {
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    if (areaB !== areaA) return areaB - areaA;
    return b.width - a.width;
  })[0];
}

function extractCandidateList(node: unknown): PhotoCandidate[] {
  const candidates: PhotoCandidate[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;

    for (const key of ["mixedSources", "sources", "jpeg", "jpg", "webp", "responsiveUrls", "urls"]) {
      const arr = obj[key];
      if (Array.isArray(arr)) arr.forEach(visit);
    }

    for (const key of ["url", "src", "href", "originalUrl", "imageUrl", "viewerUrl"]) {
      const raw = obj[key];
      if (typeof raw === "string") {
        const candidate = candidateFromUrl(raw, Number(obj.width ?? 0), Number(obj.height ?? 0));
        if (candidate) candidates.push(candidate);
      }
    }
  };

  visit(node);
  return candidates;
}

function extractGalleryPhotosFromNextData(html: string): string[] {
  const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return [];
  const raw = match[1];
  // Pull any address-photo variants from the raw JSON text (escaped slashes too).
  const re = /https:\\?\/\\?\/photos\.zillowstatic\.com\\?\/fp\\?\/[a-zA-Z0-9_-]+(?:-cc_ft_\d+|-uncropped_scaled_within_\d+_\d+)\.(?:jpg|jpeg|webp)/gi;
  const matches = Array.from(raw.matchAll(re)).map((m) => m[0].replace(/\\\//g, "/"));
  return dedupeKeepLargest(uniq(matches));
}

function extractGalleryPhotosFromViewerHtml(html: string): string[] {
  const viewerChunks = Array.from(
    html.matchAll(/<(?:div|section)[^>]*(?:carousel|gallery|viewer|media)[^>]*>[\s\S]{0,50000}?<\/(?:div|section)>/gi),
  ).map((m) => m[0]);
  if (!viewerChunks.length) return [];
  const urls = viewerChunks
    .flatMap((chunk) => Array.from(chunk.matchAll(ZILLOW_PHOTO_RE)).map((m) => m[0]))
    .map((url) => normalizePhotoUrl(url))
    .filter((url): url is string => !!url)
    .filter((url) => {
      const width = widthOf(url);
      const height = heightOf(url);
      return (!width || width >= 600) && (!height || height >= 400);
    });
  return dedupeKeepLargest(uniq(urls));
}

// Strict carousel-only extractor: cc_ft_* and uncropped_scaled_within_* are the
// gallery image variants for the actual listing address. Side ads/recommendations
// use small-thumb URLs (no cc_ft_ / no _uncropped_scaled_within_) so we exclude them.
function extractCarouselPhotosFromHtml(html: string): string[] {
  const re = /https:\/\/photos\.zillowstatic\.com\/fp\/[a-zA-Z0-9_-]+(?:-cc_ft_\d+|-uncropped_scaled_within_\d+_\d+)\.(?:jpg|jpeg|webp)/gi;
  const matches = Array.from(html.matchAll(re)).map((m) => m[0]);
  return dedupeKeepLargest(uniq(matches));
}

function extractGalleryPhotos(html: string, _markdown: string): string[] {
  // Combine all sources — Zillow lazy-loads carousel, so the FULL set lives in __NEXT_DATA__
  // JSON (responsivePhotos / hugePhotos), while the rendered HTML only has the first 1–2.
  // Concatenate, then dedupe by fingerprint keeping the largest variant.
  const fromHtml = extractCarouselPhotosFromHtml(html);
  const fromJson = extractGalleryPhotosFromNextData(html);
  const fromViewer = extractGalleryPhotosFromViewerHtml(html);
  const combined = dedupeKeepLargest(uniq([...fromJson, ...fromHtml, ...fromViewer]));
  if (combined.length) return combined;
  return [];
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
    if (!isNaN(n) && n > 100 && n < 10000000) return n;
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
        waitFor: 1800,
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
      price: parsePrice(markdown || html),
      beds: bedsMatch ? Number(bedsMatch[1]) : null,
      baths: bathsMatch ? Number(bathsMatch[1]) : null,
      sqft: sqftMatch ? Number(sqftMatch[1].replace(/,/g, "")) : null,
      property_type: parsePropertyType(markdown || html),
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

export interface SearchFilters {
  zip: string;
  beds: "any" | string;
  baths: "any" | string;
  types: string[];
  limit?: number;
  mode?: "rent" | "sale";
}

function buildQueries(filters: SearchFilters, mode: "rent" | "sale") {
  const typeStr = filters.types.includes("any") || filters.types.length === 0
    ? ""
    : ` ${filters.types.join(" or ")}`;
  const bedStr = filters.beds === "any" ? "" : ` ${filters.beds} bedroom`;
  const bathStr = filters.baths === "any" ? "" : ` ${filters.baths} bath`;
  const market = mode === "sale" ? "for sale" : "for rent";

  return [
    `site:zillow.com/homedetails ${filters.zip} ${market}${bedStr}${bathStr}${typeStr}`,
    `site:zillow.com/homedetails zillow ${filters.zip} ${market}${bedStr}${typeStr}`,
    `zillow homedetails ${filters.zip} ${market}${bedStr}${bathStr}${typeStr}`,
  ];
}

async function runSearchQuery(apiKey: string, query: string, limit: number): Promise<string[]> {
  try {
    const res = await fetch(FIRECRAWL_SEARCH, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: Math.min(limit + 6, 25) }),
    });
    if (!res.ok) {
      console.log(`Firecrawl search ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return [];
    }
    const json = await res.json();
    const items = json?.data?.web ?? json?.data ?? json?.results?.web ?? [];
    return items.map((r: any) => r.url ?? r.link).filter((u: any) => typeof u === "string");
  } catch (e) {
    console.log("search err", (e as Error).message);
    return [];
  }
}

async function scrapeZillowSearchPage(apiKey: string, zip: string, mode: "rent" | "sale", limit: number): Promise<string[]> {
  // Hit Zillow's public search results page directly through Firecrawl, then pull homedetails URLs.
  const path = mode === "sale" ? `${zip}/` : `${zip}/rentals/`;
  const url = `https://www.zillow.com/homes/${path}`;
  try {
    const res = await fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["html"], onlyMainContent: false, waitFor: 2000 }),
    });
    if (!res.ok) {
      console.log(`Zillow search-page ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return [];
    }
    const json = await res.json();
    const html: string = json?.data?.html ?? json?.data?.rawHtml ?? json?.html ?? "";
    const matches = Array.from(html.matchAll(/https:\/\/www\.zillow\.com\/homedetails\/[^"'\s<>]+/gi)).map((m) => m[0].replace(/&amp;/g, "&"));
    return uniq(matches).slice(0, limit + 10);
  } catch (e) {
    console.log("zillow search page err", (e as Error).message);
    return [];
  }
}

export async function searchRentals(filters: SearchFilters): Promise<SearchResult> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return { urls: [], modeUsed: filters.mode ?? "rent", fallbackUsed: false };
  const limit = Math.min(Math.max(filters.limit ?? 8, 1), 40);
  const requestedMode = filters.mode ?? "rent";

  const collect = async (mode: "rent" | "sale") => {
    const queries = buildQueries(filters, mode);
    const [searchHits, pageHits] = await Promise.all([
      Promise.all(queries.map((query) => runSearchQuery(apiKey, query, limit))).then((a) => a.flat()),
      scrapeZillowSearchPage(apiKey, filters.zip, mode, limit),
    ]);
    const all = [...pageHits, ...searchHits];
    const isDetail = (u: string) => /zillow\.com\/homedetails\//i.test(u);
    return uniq(all.filter(isDetail)).slice(0, limit);
  };

  const first = await collect(requestedMode);
  if (first.length || requestedMode === "sale") {
    return { urls: first, modeUsed: requestedMode, fallbackUsed: false };
  }

  const fallback = await collect("sale");
  return { urls: fallback, modeUsed: "sale", fallbackUsed: fallback.length > 0 };
}

