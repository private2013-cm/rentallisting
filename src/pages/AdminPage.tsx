// Admin page — edit listings, manage photos with pending changes, chat with tenants, broadcast.
import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, ExternalLink, Eye, EyeOff, Save, Send, Users, Trash2, Heart, X, Inbox, MessageSquare, Megaphone, Search, BarChart3, Globe, MapPin } from "lucide-react";
import { toast } from "sonner";

type Listing = {
  id: string; address: string | null; price: number | null; deposit: number | null;
  beds: number | null; baths: number | null; sqft: number | null;
  description: string | null; bio: string | null; heading: string | null; source_url: string;
  application_fee: number | null; property_type: string | null;
  link_group_id?: string;
};
type Photo = { id: string; url: string; is_hidden: boolean; position: number };
type BotUser = { telegram_id: number; username: string | null; first_name: string | null; last_name: string | null; is_allowed: boolean; is_admin: boolean; credits_remaining: number; created_at: string };
type Group = { id: string; slug: string; title: string | null; created_at: string; listing_count?: number };
type Application = { id: string; listing_id: string | null; link_group_id: string | null; data: Record<string, string>; created_at: string };
type ChatMessage = { id: string; tenant_telegram_id: number; sender: "super" | "tenant"; body: string; created_at: string; read_by_super: boolean; read_by_tenant: boolean };
type ChatThread = { tenant_telegram_id: number; messages: ChatMessage[]; unread: number; user: { telegram_id: number; username: string | null; first_name: string | null; last_name: string | null } | null };
type Fetched = { id: string; source: string | null; source_url: string; address: string | null; price: number | null; beds: number | null; baths: number | null; sqft: number | null; property_type: string | null; description: string | null; photos: string[]; search_zip: string | null; status: string; created_at: string };
type VisitorLog = { id: string; ip: string | null; city: string | null; region: string | null; country: string | null; device: string | null; browser: string | null; os: string | null; referrer: string | null; slug: string | null; created_at: string };
type VisitorStats = { total: number; last24h: number; recent: VisitorLog[] };

const AdminPage = () => {
  const { slug } = useParams();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [listings, setListings] = useState<(Listing & { photos: Photo[] })[]>([]);
  const [defaultBio, setDefaultBio] = useState("");
  const [defaultDescription, setDefaultDescription] = useState("");
  const [defaultApplicationFee, setDefaultApplicationFee] = useState<string>("");
  const [tenantHeading, setTenantHeading] = useState("Private landlord rental listing");
  const [users, setUsers] = useState<BotUser[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [interestCounts, setInterestCounts] = useState<Record<string, { yes: number; no: number }>>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [fetched, setFetched] = useState<Fetched[]>([]);
  const [visitorStats, setVisitorStats] = useState<VisitorStats>({ total: 0, last24h: 0, recent: [] });
  const [scrapeStats, setScrapeStats] = useState<{ listings_total: number; links_total: number; visits_total: number }>({ listings_total: 0, links_total: 0, visits_total: 0 });
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const adminKey = params.get("key") ?? "";
  const masterKey = params.get("master") ?? "";
  const isMaster = !slug && !!masterKey;

  const tenantUrl = slug ? `${window.location.origin}/l/${slug}` : "";

  const adminAction = async (action: string, body: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("admin-actions", {
      body: { action, slug: slug ?? null, key: adminKey, master: masterKey, ...body },
    });
    if (error || data?.error) throw new Error(data?.error || error?.message || "Admin action failed");
    return data;
  };

  const load = async () => {
    if (!slug && !masterKey) { setLoading(false); setForbidden(true); return; }
    if (slug && !adminKey) { setLoading(false); setForbidden(true); return; }
    setLoading(true);
    setErrorText("");
    try {
      const data = await adminAction("load");
      setGroupId(data.groupId ?? null);
      setGroups(data.groups ?? []);
      const items = (data.listings ?? []).map((r: any) => ({
        ...r,
        photos: (r.listing_photos ?? []).sort((a: Photo, b: Photo) => a.position - b.position),
      }));
      setListings(items);
      setDefaultBio(data.defaultBio ?? "");
      setDefaultDescription(data.defaultDescription ?? "");
      setDefaultApplicationFee(data.defaultApplicationFee != null ? String(data.defaultApplicationFee) : "");
      setTenantHeading(data.tenantHeading ?? "Private landlord rental listing");
      setUsers(data.users ?? []);
      setApplications(data.applications ?? []);
      setChatMessages(data.chatMessages ?? []);
      setChatThreads(data.chatThreads ?? []);
      setFetched(data.fetched ?? []);
      setVisitorStats(data.visitorStats ?? { total: 0, last24h: 0, recent: [] });
      setScrapeStats(data.scrapeStats ?? { listings_total: 0, links_total: 0, visits_total: 0 });
      const ids = new Set(items.map((l: any) => l.id));
      const counts: Record<string, { yes: number; no: number }> = {};
      (data.interests ?? []).forEach((i: any) => {
        if (!ids.has(i.listing_id)) return;
        if (!counts[i.listing_id]) counts[i.listing_id] = { yes: 0, no: 0 };
        if (i.is_interested) counts[i.listing_id].yes++; else counts[i.listing_id].no++;
      });
      setInterestCounts(counts);
    } catch (e: any) {
      const msg = e.message ?? "Could not load admin page";
      if (/invalid|missing/i.test(msg)) setForbidden(true);
      else setErrorText(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [slug]);

  // Realtime — only refresh things that don't disrupt active editing
  // (NO listing_photos auto-reload — pending photo edits would be lost)
  useEffect(() => {
    const ch = supabase
      .channel(`admin:${slug ?? "master"}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "listing_interests" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "applications" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_chat_messages" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [slug]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground font-sans-ui">Loading…</div>;
  if (forbidden) {
    return (
      <main className="min-h-screen bg-secondary/30 flex items-center justify-center px-6 py-12">
        <Card className="max-w-md w-full p-8 text-center shadow-soft">
          <h1 className="text-3xl font-semibold text-destructive mb-3">403 · Forbidden</h1>
          <p className="font-sans-ui text-muted-foreground mb-6">
            You don't have access to this page. Admin links require the access key sent by the bot.
          </p>
          <Button asChild variant="outline" className="font-sans-ui"><Link to="/">Go home</Link></Button>
        </Card>
      </main>
    );
  }
  if (errorText) {
    return (
      <main className="min-h-screen bg-secondary/30 flex items-center justify-center px-6 py-12">
        <Card className="max-w-lg w-full p-6 text-center shadow-soft">
          <h1 className="text-2xl font-semibold text-primary mb-3">Something went wrong</h1>
          <p className="font-sans-ui text-muted-foreground mb-5">{errorText}</p>
          <Button asChild variant="outline" className="font-sans-ui"><Link to="/">Back home</Link></Button>
        </Card>
      </main>
    );
  }

  const listingNameById = (id: string | null) => {
    if (!id) return "—";
    return listings.find((l) => l.id === id)?.address ?? "Listing";
  };

  const totalChatUnread = isMaster
    ? chatThreads.reduce((s, t) => s + (t.unread ?? 0), 0)
    : chatMessages.filter(m => m.sender === "super" && !m.read_by_tenant).length;

  return (
    <main className="min-h-screen bg-secondary/30">
      <header className="bg-primary text-primary-foreground py-6 px-6 shadow-soft">
        <div className="max-w-6xl mx-auto flex flex-wrap gap-4 items-center justify-between">
          <div>
            <p className="font-sans-ui uppercase tracking-widest text-xs text-primary-foreground/70">
              {isMaster ? "Master admin" : "Admin dashboard"}
            </p>
            <h1 className="text-2xl font-semibold">
              {isMaster ? `${groups.length} listing group${groups.length !== 1 ? "s" : ""}` : `${listings.length} listing${listings.length !== 1 ? "s" : ""} · /${slug}`}
            </h1>
          </div>
          {!isMaster && tenantUrl && (
            <Button asChild variant="secondary" className="font-sans-ui">
              <a href={tenantUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" /> View tenant page
              </a>
            </Button>
          )}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <Tabs defaultValue={isMaster ? "groups" : "listings"}>
          <TabsList className="font-sans-ui flex-wrap h-auto">
            {isMaster && <TabsTrigger value="groups">Listing groups</TabsTrigger>}
            {!isMaster && <TabsTrigger value="listings">Listings</TabsTrigger>}
            <TabsTrigger value="applications"><Inbox className="w-3.5 h-3.5 mr-1.5" />Applications{applications.length > 0 && <span className="ml-1.5 text-xs bg-accent/30 px-1.5 rounded">{applications.length}</span>}</TabsTrigger>
            <TabsTrigger value="chat"><MessageSquare className="w-3.5 h-3.5 mr-1.5" />Chat{totalChatUnread > 0 && <span className="ml-1.5 text-xs bg-destructive text-destructive-foreground px-1.5 rounded-full">{totalChatUnread}</span>}</TabsTrigger>
            {isMaster && <TabsTrigger value="broadcast"><Megaphone className="w-3.5 h-3.5 mr-1.5" />Broadcast</TabsTrigger>}
            {isMaster && <TabsTrigger value="settings">Defaults</TabsTrigger>}
            {isMaster && <TabsTrigger value="users"><Users className="w-3.5 h-3.5 mr-1.5" />Users</TabsTrigger>}
            {isMaster && <TabsTrigger value="ai"><Sparkles className="w-3.5 h-3.5 mr-1.5" />AI assistant</TabsTrigger>}
          </TabsList>

          {isMaster && (
            <TabsContent value="groups" className="mt-6">
              <Card className="p-6">
                <h3 className="font-semibold text-lg mb-1">All listing groups</h3>
                <p className="font-sans-ui text-sm text-muted-foreground mb-4">Open a group to edit its listings, photos, prices, and bio.</p>
                <div className="space-y-2 font-sans-ui">
                  {groups.map(g => (
                    <div key={g.id} className="flex items-center justify-between p-3 rounded-md bg-secondary/40">
                      <div>
                        <p className="font-medium">/{g.slug}</p>
                        <p className="text-xs text-muted-foreground">{g.listing_count ?? 0} listing(s) · created {new Date(g.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button asChild variant="outline" size="sm">
                          <a href={`/l/${g.slug}`} target="_blank" rel="noopener noreferrer">Tenant</a>
                        </Button>
                        <Button asChild size="sm">
                          <Link to={`/admin/${g.slug}?key=${masterKey}&master=${masterKey}`}>Open admin</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                  {groups.length === 0 && <p className="text-sm text-muted-foreground">No listing groups yet. Send /start in the Telegram bot to create one.</p>}
                </div>
              </Card>
            </TabsContent>
          )}

          {!isMaster && (
            <TabsContent value="listings" className="space-y-6 mt-6">
              {listings.map(l => (
                <ListingEditor key={l.id} listing={l} interest={interestCounts[l.id] ?? { yes: 0, no: 0 }} tenantUrl={tenantUrl} adminAction={adminAction} reload={load} />
              ))}
            </TabsContent>
          )}

          <TabsContent value="applications" className="mt-6">
            <ApplicationsPanel applications={applications} listingNameById={listingNameById} isMaster={isMaster} groups={groups} />
          </TabsContent>

          <TabsContent value="chat" className="mt-6">
            {isMaster ? (
              <SuperChatPanel threads={chatThreads} adminAction={adminAction} reload={load} />
            ) : (
              <TenantChatPanel messages={chatMessages} adminAction={adminAction} reload={load} />
            )}
          </TabsContent>

          {isMaster && (
            <TabsContent value="broadcast" className="mt-6">
              <BroadcastPanel adminAction={adminAction} userCount={users.length} />
            </TabsContent>
          )}

          {isMaster && (
            <TabsContent value="settings" className="mt-6 space-y-6">
              <Card className="p-6 max-w-2xl">
                <h3 className="font-semibold text-lg mb-1">Default tenant page heading</h3>
                <p className="font-sans-ui text-sm text-muted-foreground mb-4">Used when a listing has no custom heading. Each listing can override this in the Listings tab.</p>
                <Input value={tenantHeading} onChange={(e) => setTenantHeading(e.target.value)} className="font-sans-ui" />
                <Button
                  className="mt-4 bg-primary hover:bg-primary/90"
                  onClick={async () => {
                    try {
                      await adminAction("update_setting", { setting_key: "tenant_heading", value: tenantHeading });
                      toast.success("Default heading saved");
                    } catch (e: any) { toast.error(e.message); }
                  }}
                ><Save className="w-4 h-4 mr-2" />Save default heading</Button>
              </Card>

              <Card className="p-6 max-w-2xl">
                <h3 className="font-semibold text-lg mb-1">Default bio</h3>
                <p className="font-sans-ui text-sm text-muted-foreground mb-4">Auto-applied to every new scraped listing. You can override per-listing in the Listings tab.</p>
                <Textarea rows={5} value={defaultBio} onChange={(e) => setDefaultBio(e.target.value)} className="font-sans-ui" />
                <Button
                  className="mt-4 bg-primary hover:bg-primary/90"
                  onClick={async () => {
                    try {
                      await adminAction("update_setting", { setting_key: "default_bio", value: defaultBio });
                      toast.success("Default bio saved");
                    } catch (e: any) { toast.error(e.message); }
                  }}
                ><Save className="w-4 h-4 mr-2" />Save default bio</Button>
              </Card>
            </TabsContent>
          )}

          {isMaster && (
            <TabsContent value="users" className="mt-6">
              <UsersPanel users={users} reload={load} adminAction={adminAction} />
            </TabsContent>
          )}

          {isMaster && (
            <TabsContent value="ai" className="mt-6">
              <AIAssistant context={{ listings, slug }} reload={load} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </main>
  );
};

function ListingEditor({ listing, interest, tenantUrl, adminAction, reload }: { listing: Listing & { photos: Photo[] }; interest: { yes: number; no: number }; tenantUrl: string; adminAction: (action: string, body?: Record<string, unknown>) => Promise<any>; reload: () => void }) {
  const [form, setForm] = useState({
    address: listing.address ?? "",
    heading: listing.heading ?? "",
    price: listing.price ?? "",
    deposit: listing.deposit ?? "",
    beds: listing.beds ?? "",
    baths: listing.baths ?? "",
    sqft: listing.sqft ?? "",
    bio: listing.bio ?? "",
    description: listing.description ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");
  // Pending photo changes — applied only on Save
  const [pendingHidden, setPendingHidden] = useState<Record<string, boolean>>({}); // photo_id -> new is_hidden
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set()); // photo_ids to delete

  useEffect(() => {
    setForm({
      address: listing.address ?? "",
      heading: listing.heading ?? "",
      price: listing.price ?? "",
      deposit: listing.deposit ?? "",
      beds: listing.beds ?? "",
      baths: listing.baths ?? "",
      sqft: listing.sqft ?? "",
      bio: listing.bio ?? "",
      description: listing.description ?? "",
    });
    setPendingHidden({});
    setPendingDelete(new Set());
  }, [listing.id]);

  const dirty = pendingDelete.size > 0 || Object.keys(pendingHidden).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      await adminAction("update_listing", { listing_id: listing.id, values: {
        address: form.address || null,
        heading: form.heading || null,
        price: form.price === "" ? null : Number(form.price),
        deposit: form.deposit === "" ? null : Number(form.deposit),
        beds: form.beds === "" ? null : Number(form.beds),
        baths: form.baths === "" ? null : Number(form.baths),
        sqft: form.sqft === "" ? null : Math.round(Number(form.sqft)),
        bio: form.bio || null,
        description: form.description || null,
      } });
      // Apply pending photo edits
      for (const [pid, hidden] of Object.entries(pendingHidden)) {
        if (pendingDelete.has(pid)) continue;
        await adminAction("toggle_photo", { photo_id: pid, is_hidden: hidden });
      }
      for (const pid of pendingDelete) {
        await adminAction("delete_photo", { photo_id: pid });
      }
      toast.success("Listing updated — tenant page is live");
      reload();
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  const togglePhotoLocal = (p: Photo) => {
    setPendingHidden(prev => {
      const current = pendingHidden[p.id] ?? p.is_hidden;
      return { ...prev, [p.id]: !current };
    });
  };
  const deletePhotoLocal = (p: Photo) => {
    setPendingDelete(prev => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
      return next;
    });
  };
  const deleteListing = async () => {
    if (!confirm("Delete this entire listing?")) return;
    await adminAction("delete_listing", { listing_id: listing.id });
    toast.success("Listing deleted");
    reload();
  };
  const addPhoto = async () => {
    if (!photoUrl.trim()) return;
    try {
      await adminAction("add_photo", { listing_id: listing.id, url: photoUrl.trim() });
      setPhotoUrl("");
      toast.success("Photo added");
      reload();
    } catch (e: any) { toast.error(e.message); }
  };

  const visibleCount = listing.photos.filter(p => {
    if (pendingDelete.has(p.id)) return false;
    const h = pendingHidden[p.id] ?? p.is_hidden;
    return !h;
  }).length;

  return (
    <Card className="p-6 shadow-soft">
      <div className="flex flex-wrap gap-3 items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-lg">{listing.address ?? "Untitled listing"}</h3>
          <p className="font-sans-ui text-xs text-muted-foreground truncate max-w-md">
            <a href={listing.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">Source ↗</a>
          </p>
        </div>
        <div className="flex gap-3 items-center font-sans-ui text-sm">
          <span className="inline-flex items-center gap-1 text-success"><Heart className="w-4 h-4" /> {interest.yes}</span>
          <span className="inline-flex items-center gap-1 text-muted-foreground"><X className="w-4 h-4" /> {interest.no}</span>
          <Button onClick={deleteListing} variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-sans-ui">
        <div className="md:col-span-2">
          <Label>Page heading <span className="text-xs text-muted-foreground">(small line above the listing — leave blank to use default)</span></Label>
          <Input value={form.heading} onChange={(e) => setForm({ ...form, heading: e.target.value })} placeholder="e.g. Cozy 2-bed in Brooklyn" />
        </div>
        <div className="md:col-span-2">
          <Label>Address</Label>
          <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div><Label>Price ($)</Label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
        <div><Label>Deposit ($)</Label><Input type="number" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} /></div>
        <div><Label>Beds</Label><Input type="number" value={form.beds} onChange={(e) => setForm({ ...form, beds: e.target.value })} /></div>
        <div><Label>Baths</Label><Input type="number" step="0.5" value={form.baths} onChange={(e) => setForm({ ...form, baths: e.target.value })} /></div>
        <div className="md:col-span-2"><Label>Square feet</Label><Input type="number" value={form.sqft} onChange={(e) => setForm({ ...form, sqft: e.target.value })} placeholder="Leave blank to hide" /></div>
        <div className="md:col-span-2">
          <Label>Bio (shown in green box on tenant page)</Label>
          <Textarea rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <Label>Description</Label>
          <Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </div>

      <div className="flex gap-3 mt-5 items-center">
        <Button onClick={save} disabled={saving} className="bg-primary hover:bg-primary/90"><Save className="w-4 h-4 mr-2" />{saving ? "Saving…" : "Save"}</Button>
        <Button asChild variant="outline">
          <a href={tenantUrl} target="_blank" rel="noopener noreferrer"><Eye className="w-4 h-4 mr-2" />View tenant page</a>
        </Button>
        {dirty && <span className="text-xs text-accent font-sans-ui">● Unsaved photo changes</span>}
      </div>

      <div className="mt-6">
        <p className="font-sans-ui text-sm font-medium mb-2">Photos ({listing.photos.length} total · {visibleCount} will be visible after save)</p>
        <div className="flex flex-col sm:flex-row gap-2 mb-3 font-sans-ui">
          <Input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="Paste image URL to add a photo" />
          <Button onClick={addPhoto} disabled={!photoUrl.trim()} variant="outline">Add photo</Button>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {listing.photos.map(p => {
            const willHide = pendingHidden[p.id] ?? p.is_hidden;
            const willDelete = pendingDelete.has(p.id);
            return (
              <div key={p.id} className={`relative aspect-square rounded-md overflow-hidden border-2 ${willDelete ? "border-destructive opacity-30" : willHide ? "border-destructive opacity-50" : "border-border"}`}>
                <img src={p.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                <div className="absolute inset-0 flex items-end justify-between p-1 bg-gradient-to-t from-black/70 via-transparent opacity-0 hover:opacity-100 transition">
                  <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => togglePhotoLocal(p)} disabled={willDelete}>
                    {willHide ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </Button>
                  <Button size="sm" variant={willDelete ? "secondary" : "destructive"} className="h-7 px-2 text-xs" onClick={() => deletePhotoLocal(p)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
                {willDelete && <span className="absolute top-1 left-1 bg-destructive text-destructive-foreground text-[10px] px-1.5 py-0.5 rounded font-sans-ui">DELETE</span>}
                {!willDelete && willHide && <span className="absolute top-1 left-1 bg-destructive text-destructive-foreground text-[10px] px-1.5 py-0.5 rounded font-sans-ui">HIDE</span>}
              </div>
            );
          })}
        </div>
        {dirty && (
          <p className="font-sans-ui text-xs text-muted-foreground mt-3">Photo changes are pending — click <b>Save</b> above to apply them.</p>
        )}
      </div>
    </Card>
  );
}

function UsersPanel({ users, reload, adminAction }: { users: BotUser[]; reload: () => void; adminAction: (action: string, body?: Record<string, unknown>) => Promise<any> }) {
  const toggle = async (u: BotUser) => {
    await adminAction("toggle_user", { telegram_id: u.telegram_id, is_allowed: !u.is_allowed });
    reload();
  };
  const setCredits = async (u: BotUser, value: string) => {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 0) { toast.error("Enter a number ≥ 0"); return; }
    try {
      await adminAction("set_credits", { telegram_id: u.telegram_id, credits: n });
      toast.success(`${u.first_name ?? u.username ?? u.telegram_id} → ${n} credits`);
      reload();
    } catch (e: any) { toast.error(e.message); }
  };
  return (
    <Card className="p-6">
      <h3 className="font-semibold text-lg mb-1">Bot users</h3>
      <p className="font-sans-ui text-sm text-muted-foreground mb-4">
        New users get a <b>3-use trial</b>. Each Zillow link costs <b>1 credit</b>. Set a balance to top up — when it hits 0, the bot stops working for them until you top up again. Admins are unlimited.
      </p>
      <div className="space-y-2 font-sans-ui">
        {users.map(u => {
          const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || `id ${u.telegram_id}`;
          return (
            <div key={u.telegram_id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-md bg-secondary/40">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">
                  {name} {u.is_admin && <span className="ml-2 text-xs text-accent">ADMIN</span>}
                </p>
                <p className="text-xs text-muted-foreground truncate">@{u.username ?? "—"} · {u.telegram_id}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Credits</span>
                <Input
                  type="number"
                  defaultValue={u.credits_remaining}
                  className="w-20 h-8"
                  min={0}
                  disabled={u.is_admin}
                  onBlur={(e) => {
                    if (Number(e.target.value) !== u.credits_remaining) setCredits(u, e.target.value);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                />
                <Button size="sm" variant={u.is_allowed ? "destructive" : "default"} onClick={() => toggle(u)} disabled={u.is_admin}>
                  {u.is_allowed ? "Revoke" : "Allow"}
                </Button>
              </div>
            </div>
          );
        })}
        {users.length === 0 && <p className="text-sm text-muted-foreground">No users yet. They'll appear here after pressing /start in Telegram.</p>}
      </div>
    </Card>
  );
}

function AIAssistant({ context, reload }: { context: any; reload: () => void }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([
    { role: "assistant", content: "Hi! I can edit listings on this page. Try: \"set the deposit on the first listing to $1500\" or \"hide all photos except the first 5 on listing 1\"." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const compactCtx = useMemo(() => ({
    listings: context.listings.map((l: any) => ({
      id: l.id,
      address: l.address, price: l.price, deposit: l.deposit, beds: l.beds, baths: l.baths,
      bio_preview: (l.bio ?? "").slice(0, 80),
      photos: l.photos.map((p: any) => ({ id: p.id, position: p.position, is_hidden: p.is_hidden })),
    })),
  }), [context.listings]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user" as const, content: input };
    setMessages(m => [...m, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-ai", {
        body: { messages: [...messages, userMsg].slice(-12), context: compactCtx },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessages(m => [...m, { role: "assistant", content: data.reply || "(no reply)" }]);
      reload();
    } catch (e: any) {
      setMessages(m => [...m, { role: "assistant", content: `Error: ${e.message ?? "unknown"}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6 max-w-3xl">
      <h3 className="font-semibold text-lg mb-1 flex items-center gap-2"><Sparkles className="w-4 h-4 text-accent" />AI assistant</h3>
      <p className="font-sans-ui text-sm text-muted-foreground mb-4">
        Edits content live: prices, deposits, bios, photo visibility, default bio, button URL.
      </p>
      <div className="space-y-3 max-h-96 overflow-y-auto mb-4 pr-2 font-sans-ui">
        {messages.map((m, i) => (
          <div key={i} className={`p-3 rounded-lg text-sm ${m.role === "user" ? "bg-primary text-primary-foreground ml-8" : "bg-secondary/60 mr-8"}`}>
            {m.content}
          </div>
        ))}
        {loading && <div className="text-sm text-muted-foreground italic">Thinking…</div>}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="Tell me what to change…"
          className="font-sans-ui"
          disabled={loading}
        />
        <Button onClick={send} disabled={loading || !input.trim()} className="bg-primary hover:bg-primary/90">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </Card>
  );
}

function ApplicationsPanel({ applications, listingNameById, isMaster, groups }: {
  applications: Application[];
  listingNameById: (id: string | null) => string;
  isMaster: boolean;
  groups: Group[];
}) {
  const groupSlug = (gid: string | null) => {
    if (!gid) return "—";
    return groups.find((g) => g.id === gid)?.slug ?? "—";
  };
  return (
    <Card className="p-6">
      <h3 className="font-semibold text-lg mb-1">{isMaster ? "All applications" : "Applications for your listings"}</h3>
      <p className="font-sans-ui text-sm text-muted-foreground mb-4">
        Each submission is also forwarded to {isMaster ? "you on Telegram" : "your Telegram and the super admin"}.
      </p>
      {applications.length === 0 && (
        <p className="font-sans-ui text-sm text-muted-foreground">No applications yet.</p>
      )}
      <div className="space-y-3 font-sans-ui">
        {applications.map((a) => (
          <div key={a.id} className="p-4 rounded-md bg-secondary/40 border border-border">
            <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
              <div>
                <p className="font-medium text-sm">🏠 {listingNameById(a.listing_id)}</p>
                {isMaster && (
                  <p className="text-xs text-muted-foreground">Group: /{groupSlug(a.link_group_id)}</p>
                )}
              </div>
              <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {Object.entries(a.data || {}).map(([k, v]) => (
                <div key={k} className="break-words">
                  <span className="text-muted-foreground">{k}:</span> <span className="font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SuperChatPanel({ threads, adminAction, reload }: { threads: ChatThread[]; adminAction: (a: string, b?: Record<string, unknown>) => Promise<any>; reload: () => void }) {
  const [active, setActive] = useState<number | null>(threads[0]?.tenant_telegram_id ?? null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeThread = threads.find(t => t.tenant_telegram_id === active) ?? null;

  useEffect(() => {
    if (active && activeThread?.unread) {
      adminAction("mark_chat_read", { tenant_telegram_id: active }).catch(() => {});
    }
    // eslint-disable-next-line
  }, [active]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeThread?.messages.length]);

  const send = async () => {
    if (!input.trim() || !active || sending) return;
    setSending(true);
    try {
      await adminAction("send_chat", { tenant_telegram_id: active, body: input.trim() });
      setInput("");
      reload();
    } catch (e: any) { toast.error(e.message); }
    setSending(false);
  };

  return (
    <Card className="p-0 overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] min-h-[500px]">
        <aside className="border-r border-border bg-secondary/30 max-h-[600px] overflow-y-auto">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold flex items-center gap-2"><MessageSquare className="w-4 h-4" />Tenant chats</h3>
            <p className="text-xs text-muted-foreground font-sans-ui mt-1">{threads.length} thread(s)</p>
          </div>
          <div className="font-sans-ui text-sm">
            {threads.map(t => {
              const name = [t.user?.first_name, t.user?.last_name].filter(Boolean).join(" ") || t.user?.username || `id ${t.tenant_telegram_id}`;
              const last = t.messages[t.messages.length - 1];
              return (
                <button key={t.tenant_telegram_id} onClick={() => setActive(t.tenant_telegram_id)} className={`w-full text-left p-3 border-b border-border/60 hover:bg-secondary/60 transition ${active === t.tenant_telegram_id ? "bg-secondary/80" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{name}</span>
                    {t.unread > 0 && <span className="text-xs bg-destructive text-destructive-foreground rounded-full px-1.5 min-w-[18px] text-center">{t.unread}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{last?.body ?? "—"}</p>
                </button>
              );
            })}
            {threads.length === 0 && <p className="p-4 text-muted-foreground text-xs">No chats yet. Tenants can start one from the bot ("💬 Message admin") or their admin page.</p>}
          </div>
        </aside>
        <section className="flex flex-col max-h-[600px]">
          {activeThread ? (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 font-sans-ui">
                {activeThread.messages.map(m => (
                  <div key={m.id} className={`max-w-[80%] p-3 rounded-lg text-sm ${m.sender === "super" ? "ml-auto bg-primary text-primary-foreground" : "bg-secondary"}`}>
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className="text-[10px] opacity-70 mt-1">{new Date(m.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-border flex gap-2">
                <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Type a message…" className="font-sans-ui" disabled={sending} />
                <Button onClick={send} disabled={sending || !input.trim()}><Send className="w-4 h-4" /></Button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground font-sans-ui text-sm">Pick a tenant to chat with.</div>
          )}
        </section>
      </div>
    </Card>
  );
}

function TenantChatPanel({ messages, adminAction, reload }: { messages: ChatMessage[]; adminAction: (a: string, b?: Record<string, unknown>) => Promise<any>; reload: () => void }) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages.length]);

  const send = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await adminAction("send_chat", { body: input.trim() });
      setInput("");
      reload();
    } catch (e: any) { toast.error(e.message); }
    setSending(false);
  };

  return (
    <Card className="p-0 overflow-hidden flex flex-col max-h-[600px]">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold flex items-center gap-2"><MessageSquare className="w-4 h-4" />Chat with admin</h3>
        <p className="text-xs text-muted-foreground font-sans-ui mt-1">Messages also arrive in your Telegram bot.</p>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 font-sans-ui min-h-[300px]">
        {messages.length === 0 && <p className="text-sm text-muted-foreground text-center mt-12">No messages yet. Say hi 👋</p>}
        {messages.map(m => (
          <div key={m.id} className={`max-w-[80%] p-3 rounded-lg text-sm ${m.sender === "tenant" ? "ml-auto bg-primary text-primary-foreground" : "bg-secondary"}`}>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            <p className="text-[10px] opacity-70 mt-1">{new Date(m.created_at).toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-border flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Type a message to the admin…" className="font-sans-ui" disabled={sending} />
        <Button onClick={send} disabled={sending || !input.trim()}><Send className="w-4 h-4" /></Button>
      </div>
    </Card>
  );
}

function BroadcastPanel({ adminAction, userCount }: { adminAction: (a: string, b?: Record<string, unknown>) => Promise<any>; userCount: number }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!body.trim()) return;
    if (!confirm(`Send this to all ${userCount} bot user(s)?`)) return;
    setSending(true);
    try {
      const res = await adminAction("broadcast", { body: body.trim() });
      toast.success(`Broadcast sent — ✅ ${res.sent} · ❌ ${res.failed}`);
      setBody("");
    } catch (e: any) { toast.error(e.message); }
    setSending(false);
  };
  return (
    <Card className="p-6 max-w-2xl">
      <h3 className="font-semibold text-lg mb-1 flex items-center gap-2"><Megaphone className="w-4 h-4 text-accent" />Broadcast to all users</h3>
      <p className="font-sans-ui text-sm text-muted-foreground mb-4">
        Sends a Telegram message to <b>every</b> bot user ({userCount} total). Supports HTML formatting (e.g. <code>&lt;b&gt;bold&lt;/b&gt;</code>).
      </p>
      <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} className="font-sans-ui" placeholder="Hey everyone — new feature: …" />
      <Button onClick={send} disabled={sending || !body.trim()} className="mt-4 bg-primary hover:bg-primary/90">
        <Send className="w-4 h-4 mr-2" />{sending ? "Sending…" : `Send to ${userCount} user(s)`}
      </Button>
    </Card>
  );
}

export default AdminPage;
