import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Shield } from "lucide-react";

const Index = () => {
  const [adminKey, setAdminKey] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "master_admin_key")
      .maybeSingle()
      .then(({ data }) => setAdminKey(typeof data?.value === "string" ? data.value : null));
  }, []);

  return (
    <main className="min-h-screen bg-gradient-warm flex items-center justify-center px-6">
      <div className="max-w-2xl text-center space-y-8">
        <div className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-sans-ui font-medium tracking-wide uppercase">
          Private landlord rentals
        </div>
        <h1 className="text-5xl md:text-6xl font-semibold text-primary leading-tight">
          A Telegram bot that turns Zillow links into rental tour pages.
        </h1>
        <p className="text-lg text-muted-foreground font-sans-ui">
          Send your bot a Zillow URL. It scrapes photos, beds, and price, and gives you a clean shareable link to send tenants.
        </p>
        <div className="pt-4 space-y-3">
          <p className="font-sans-ui text-sm text-muted-foreground">
            Open Telegram and message your bot <code className="px-2 py-0.5 bg-muted rounded">/start</code>.
          </p>
          {adminKey && (
            <Link
              to={`/admin?master=${adminKey}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground font-sans-ui text-sm font-medium hover:bg-primary/90 transition"
            >
              <Shield className="w-4 h-4" /> Open admin dashboard
            </Link>
          )}
        </div>
      </div>
    </main>
  );
};

export default Index;
