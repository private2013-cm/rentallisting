// Re-exports the multi-source scraper for backwards compatibility.
export { scrapeListing as scrapeZillow, draftFromUrl, detectSource, searchRentals } from "./scraper.ts";
export type { ScrapedListing, SearchFilters } from "./scraper.ts";
