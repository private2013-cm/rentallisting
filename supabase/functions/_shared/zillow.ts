// Zillow scraper — uses Firecrawl to bypass anti-bot walls reliably.

export interface ScrapedListing {
  source_url: string;
  address: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  description: string | null;
  photos: string[];
}

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/scrape";

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

// Zillow serves the same photo at many sizes — strip size/crop suffixes so the
// canonical photo id is what we dedupe on. Keep the largest variant we find.
function photoFingerprint(u: string): string {
  return u
    .replace(/-uncropped_scaled_within_\d+_\d+/i, "")
    .replace(/-cc_ft_\d+/i, "")
    .replace(/\.(jpg|jpeg|webp)$/i, "");
}
function dedupePhotos(urls: string[]): string[] {
  const map = new Map<string, string>();
  for (const u of urls) {
    const fp = photoFingerprint(u);
    const prev = map.get(fp);
    // Prefer the URL whose explicit width number is largest; otherwise keep first.
    const widthOf = (s: string) => Number(s.match(/_within_(\d+)_/)?.[1] ?? s.match(/-cc_ft_(\d+)/)?.[1] ?? 0);
    if (!prev || widthOf(u) > widthOf(prev)) map.set(fp, u);
  }
  return Array.from(map.values());
}

export function draftFromUrl(url: string): ScrapedListing {
  const clean = decodeURIComponent(url);
  const zpid = clean.match(/\/(\d+)_zpid/i)?.[1] ?? clean.match(/[?&]zpid=(\d+)/i)?.[1] ?? null;
  const slugPart = clean.match(/homedetails\/([^/]+)\//i)?.[1] ?? "";
  let address = slugPart
    .replace(/\d+_zpid.*/i, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (address) address = address.replace(/\b([A-Z]{2})\s+(\d{5}(?: \d{4})?)$/i, "$1 $2");
  return {
    source_url: url,
    address: address || (zpid ? `Zillow listing ${zpid}` : "Address pending"),
    price: null,
    beds: null,
    baths: null,
    sqft: null,
    description: zpid ? `Zillow link saved. ZPID: ${zpid}. Edit the full listing details on the admin page.` : "Zillow link saved. Edit the full listing details on the admin page.",
    photos: [],
  };
}

function parseFromContent(markdown: string, html: string, url: string): ScrapedListing {
  const text = markdown || "";
  const fullHtml = html || "";

  // Photos — pull from both markdown and html
  const photoRe = /https:\/\/photos\.zillowstatic\.com\/fp\/[a-zA-Z0-9_-]+(?:-uncropped_scaled_within_\d+_\d+|-cc_ft_\d+)?\.(?:jpg|webp|jpeg)/gi;
  const photos = dedupePhotos(uniq([...(text.match(photoRe) ?? []), ...(fullHtml.match(photoRe) ?? [])]));

  // Price
  let price: number | null = null;
  const priceMatch = text.match(/\$\s*([\d,]+)\s*(?:\/\s*mo|per month)?/i);
  if (priceMatch) {
    const n = parseInt(priceMatch[1].replace(/,/g, ""), 10);
    if (!isNaN(n) && n > 100) price = n;
  }

  const bedsMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:bd|bed|beds|bedroom)/i);
  const bathsMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:ba|bath|baths|bathroom)/i);
  const sqftMatch = text.match(/([\d,]+)\s*(?:sqft|sq\.?\s*ft)/i);

  let address: string | null = null;
  const addrMatch = text.match(/\d{1,6}\s+[A-Z][\w\s\.]+,\s*[A-Z][\w\s]+,\s*[A-Z]{2}\s*\d{5}/);
  if (addrMatch) address = addrMatch[0];
  if (!address) {
    const titleMatch = text.match(/(?:Title:|^#)\s*([^\n]+)/m);
    if (titleMatch) address = titleMatch[1].trim().split("|")[0].trim();
  }

  // Description: grab a meaningful chunk after "Description" / "About" heading if present
  let description: string | null = null;
  const descMatch = text.match(/(?:^|\n)#+\s*(?:Description|About|What's special)[^\n]*\n+([\s\S]{60,1500}?)(?:\n#+|\n\n\n|$)/i);
  if (descMatch) description = descMatch[1].trim();

  return {
    source_url: url,
    address,
    price,
    beds: bedsMatch ? Number(bedsMatch[1]) : null,
    baths: bathsMatch ? Number(bathsMatch[1]) : null,
    sqft: sqftMatch ? Number(sqftMatch[1].replace(/,/g, "")) : null,
    description,
    photos,
  };
}

export async function scrapeZillow(url: string): Promise<ScrapedListing> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) {
    console.log("FIRECRAWL_API_KEY not configured — using draft fallback");
    return draftFromUrl(url);
  }

  try {
    const res = await fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "html"],
        onlyMainContent: false,
        waitFor: 2500,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.log(`Firecrawl ${res.status}: ${errText.slice(0, 300)}`);
      return draftFromUrl(url);
    }

    const json = await res.json();
    const data = json?.data ?? json;
    const markdown: string = data?.markdown ?? "";
    const html: string = data?.html ?? data?.rawHtml ?? "";
    const meta = data?.metadata ?? {};

    const parsed = parseFromContent(markdown, html, url);

    // Backfill address from metadata title if needed
    if (!parsed.address && meta?.title) {
      parsed.address = String(meta.title).split("|")[0].trim();
    }
    if (!parsed.description && meta?.description) {
      parsed.description = String(meta.description);
    }

    if (parsed.photos.length === 0 && !parsed.price && !parsed.address) {
      return draftFromUrl(url);
    }
    return parsed;
  } catch (e) {
    console.log(`Firecrawl error: ${(e as Error).message}`);
    return draftFromUrl(url);
  }
}
