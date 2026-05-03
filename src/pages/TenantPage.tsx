// Tenant-facing listing page. Shows all listings in a link group with photo gallery,
// price, deposit, beds, bio, and Apply / Tour / Interested / Not interested buttons.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Bed, Bath, Home, Heart, X, Calendar, FileText } from "lucide-react";
import { toast } from "sonner";
import { ApplyDialog } from "@/components/ApplyDialog";

type Listing = {
  id: string;
  address: string | null;
  price: number | null;
  deposit: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  description: string | null;
  bio: string | null;
  heading: string | null;
  application_fee: number | null;
};
type Photo = { id: string; url: string; is_hidden: boolean; position: number };

const TenantPage = () => {
  const { slug } = useParams();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [listings, setListings] = useState<(Listing & { photos: Photo[] })[]>([]);
  const [heading, setHeading] = useState("Private landlord rental listing");

  useEffect(() => {
    if (!slug) return;
    const load = async () => {
      const { data: settings } = await supabase
        .from("app_settings")
        .select("key, value")
        .in("key", ["tenant_heading"]);
      const headingRow = settings?.find((s: any) => s.key === "tenant_heading");
      if (headingRow?.value) setHeading(String(headingRow.value));

      const { data: group } = await supabase.from("link_groups").select("id").eq("slug", slug).maybeSingle();
      if (!group) { setNotFound(true); setLoading(false); return; }

      const { data: rows } = await supabase
        .from("listings")
        .select("id, address, price, deposit, beds, baths, sqft, description, bio, heading, application_fee, position, listing_photos(id, url, is_hidden, position)")
        .eq("link_group_id", group.id)
        .order("position");

      // Log visit (fire and forget)
      supabase.functions.invoke("log-visit", { body: { slug, referrer: document.referrer } }).catch(() => {});

      const items = (rows ?? []).map((r: any) => ({
        ...r,
        photos: (r.listing_photos ?? []).filter((p: Photo) => !p.is_hidden).sort((a: Photo, b: Photo) => a.position - b.position),
      }));
      setListings(items);
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel(`tenant:${slug}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "listings" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "listing_photos" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [slug]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground font-sans-ui">Loading…</div>;
  if (notFound) return <div className="min-h-screen flex items-center justify-center text-muted-foreground font-sans-ui">Listing not found.</div>;

  // If exactly one listing, prefer its custom heading in the header.
  const headerHeading = listings.length === 1 && listings[0]?.heading ? listings[0].heading : heading;

  return (
    <main className="min-h-screen bg-gradient-warm pb-16">
      <header className="bg-primary text-primary-foreground py-8 px-6 shadow-soft">
        <div className="max-w-5xl mx-auto">
          <p className="font-sans-ui uppercase tracking-widest text-xs text-primary-foreground/70 mb-2">{headerHeading}</p>
          <h1 className="text-3xl md:text-4xl font-semibold">
            {listings.length === 1 ? "Available now" : `${listings.length} listings available`}
          </h1>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 mt-10 space-y-12">
        {listings.map((l) => (
          <ListingCard key={l.id} listing={l} fallbackHeading={heading} showHeading={listings.length > 1} />
        ))}
      </div>
    </main>
  );
};

function ListingCard({ listing, fallbackHeading, showHeading }: { listing: Listing & { photos: Photo[] }; fallbackHeading: string; showHeading: boolean }) {
  const [active, setActive] = useState(0);
  const [interestSent, setInterestSent] = useState<null | boolean>(null);
  const [dialog, setDialog] = useState<null | "apply" | "tour">(null);

  const photos = listing.photos;
  const next = () => setActive((i) => (i + 1) % Math.max(photos.length, 1));
  const prev = () => setActive((i) => (i - 1 + photos.length) % Math.max(photos.length, 1));

  const sendInterest = async (is_interested: boolean) => {
    setInterestSent(is_interested);
    try {
      await supabase.functions.invoke("log-interest", { body: { listing_id: listing.id, is_interested } });
      toast.success(is_interested ? "The landlord has been notified." : "Got it — thanks for letting us know.");
    } catch (_) {
      toast.error("Couldn't send. Try again.");
      setInterestSent(null);
    }
  };

  return (
    <Card className="overflow-hidden shadow-elevated bg-card border-border/60">
      {/* Photo gallery */}
      <div className="relative bg-muted aspect-[16/10] sm:aspect-[16/9] group">
        {photos.length > 0 ? (
          <>
            <img
              src={photos[active]?.url}
              alt={`${listing.address ?? "Listing"} photo ${active + 1}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {photos.length > 1 && (
              <>
                <button onClick={prev} aria-label="Previous photo" className="absolute left-3 top-1/2 -translate-y-1/2 bg-card/85 backdrop-blur p-2 rounded-full shadow-soft hover:bg-card">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button onClick={next} aria-label="Next photo" className="absolute right-3 top-1/2 -translate-y-1/2 bg-card/85 backdrop-blur p-2 rounded-full shadow-soft hover:bg-card">
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-foreground/70 text-background font-sans-ui text-xs px-3 py-1 rounded-full">
                  {active + 1} / {photos.length}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground font-sans-ui">No photos available</div>
        )}
      </div>

      {/* Thumbnail strip */}
      {photos.length > 1 && (
        <div className="flex gap-2 p-3 overflow-x-auto bg-secondary/50 border-b border-border">
          {photos.map((p, i) => (
            <button key={p.id} onClick={() => setActive(i)} className={`flex-shrink-0 w-20 h-14 rounded-md overflow-hidden border-2 transition ${i === active ? "border-accent" : "border-transparent opacity-70 hover:opacity-100"}`}>
              <img src={p.url} alt="" className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <div className="p-6 sm:p-8 space-y-5">
        <div>
          {showHeading && (
            <p className="font-sans-ui uppercase tracking-widest text-xs text-muted-foreground mb-2">
              {listing.heading ?? fallbackHeading}
            </p>
          )}
          <h2 className="text-2xl sm:text-3xl font-semibold text-primary leading-tight">
            {listing.address ?? "Address pending"}
          </h2>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-3 font-sans-ui text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Bed className="w-4 h-4" /> {listing.beds ?? "—"} bed</span>
          <span className="inline-flex items-center gap-1.5"><Bath className="w-4 h-4" /> {listing.baths ?? "—"} bath</span>
          {listing.sqft && <span className="inline-flex items-center gap-1.5"><Home className="w-4 h-4" /> {listing.sqft.toLocaleString()} sqft</span>}
        </div>

        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 pt-2 border-t border-border">
          <div>
            <p className="font-sans-ui text-xs uppercase tracking-wider text-muted-foreground">Monthly rent</p>
            <p className="text-3xl font-semibold text-primary">${listing.price?.toLocaleString() ?? "—"}</p>
          </div>
          <div>
            <p className="font-sans-ui text-xs uppercase tracking-wider text-muted-foreground">Deposit</p>
            <p className="text-2xl font-semibold text-foreground">{listing.deposit ? `$${listing.deposit.toLocaleString()}` : "—"}</p>
          </div>
        </div>

        {listing.bio && (
          <div className="bg-secondary/60 border border-border rounded-lg p-4 font-sans-ui text-sm leading-relaxed text-foreground">
            {listing.bio}
          </div>
        )}

        {listing.description && (
          <details className="font-sans-ui text-sm text-muted-foreground">
            <summary className="cursor-pointer text-primary font-medium">More details</summary>
            <p className="mt-2 whitespace-pre-line leading-relaxed">{listing.description}</p>
          </details>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <Button onClick={() => setDialog("apply")} size="lg" className="bg-primary hover:bg-primary/90 font-sans-ui">
            <FileText className="w-4 h-4 mr-2" /> Apply now
          </Button>
          <Button onClick={() => setDialog("tour")} size="lg" variant="outline" className="font-sans-ui border-primary/30 text-primary hover:bg-primary/5">
            <Calendar className="w-4 h-4 mr-2" /> Schedule a tour
          </Button>
          <Button onClick={() => sendInterest(true)} disabled={interestSent !== null} variant={interestSent === true ? "default" : "secondary"} size="lg" className="font-sans-ui">
            <Heart className={`w-4 h-4 mr-2 ${interestSent === true ? "fill-current" : ""}`} />
            {interestSent === true ? "Sent" : "Interested"}
          </Button>
          <Button onClick={() => sendInterest(false)} disabled={interestSent !== null} variant="ghost" size="lg" className="font-sans-ui text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4 mr-2" />
            {interestSent === false ? "Sent" : "Not interested"}
          </Button>
        </div>
      </div>

      <ApplyDialog
        open={dialog !== null}
        onOpenChange={(v) => { if (!v) setDialog(null); }}
        intent={dialog ?? "apply"}
        listingId={listing.id}
      />
    </Card>
  );
}

export default TenantPage;
