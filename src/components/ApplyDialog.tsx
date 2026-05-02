// Pop-up application form used by both Apply now & Schedule a tour buttons on the tenant page.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(100),
  email: z.string().trim().email("Invalid email").max(200),
  phone: z.string().trim().min(5, "Required").max(40),
  age: z.string().trim().max(3).optional().or(z.literal("")),
  current_address: z.string().trim().max(300).optional().or(z.literal("")),
  monthly_income: z.string().trim().max(40).optional().or(z.literal("")),
  lease_duration: z.string().trim().max(60).optional().or(z.literal("")),
  bedrooms_desired: z.string().trim().max(10).optional().or(z.literal("")),
  bathrooms_desired: z.string().trim().max(10).optional().or(z.literal("")),
  adults_moving_in: z.string().trim().max(10).optional().or(z.literal("")),
  smoke: z.string().trim().max(20).optional().or(z.literal("")),
  pet: z.string().trim().max(60).optional().or(z.literal("")),
  car: z.string().trim().max(20).optional().or(z.literal("")),
  reasons_for_moving: z.string().trim().max(500).optional().or(z.literal("")),
  criminal_record: z.string().trim().max(60).optional().or(z.literal("")),
  agrees: z.string().trim().max(20).optional().or(z.literal("")),
  payment_method: z.string().trim().max(40).optional().or(z.literal("")),
});

type FieldDef = { key: keyof z.infer<typeof schema>; label: string; type?: string; options?: string[]; textarea?: boolean };
const fields: FieldDef[] = [
  { key: "name", label: "👤 Name" },
  { key: "email", label: "✉️ Email", type: "email" },
  { key: "phone", label: "📞 Phone number", type: "tel" },
  { key: "age", label: "🎂 Age", type: "number" },
  { key: "current_address", label: "🏠 Current address" },
  { key: "monthly_income", label: "💰 Monthly income" },
  { key: "lease_duration", label: "📄 Lease duration" },
  { key: "bedrooms_desired", label: "🛏️ Bedrooms desired", type: "number" },
  { key: "bathrooms_desired", label: "🛁 Bathrooms desired", type: "number" },
  { key: "adults_moving_in", label: "👥 Adults moving in", type: "number" },
  { key: "smoke", label: "🚭 Do you smoke?", options: ["Yes", "No"] },
  { key: "pet", label: "🐶 Pet? (type/breed if yes)" },
  { key: "car", label: "🚗 Do you have a car?", options: ["Yes", "No"] },
  { key: "reasons_for_moving", label: "📝 Reasons for moving", textarea: true },
  { key: "criminal_record", label: "⚠️ Criminal record?", options: ["No", "Yes"] },
  { key: "agrees", label: "✅ Agreed to terms?", options: ["Yes", "No"] },
  { key: "payment_method", label: "💵 Application fee payment method", options: ["Chime", "Apple Pay", "Zelle", "PayPal", "Venmo"] },
];

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  intent: "apply" | "tour";
  listingId: string;
  linkGroupId?: string | null;
};

export function ApplyDialog({ open, onOpenChange, intent, listingId, linkGroupId }: Props) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const update = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const reset = () => { setForm({}); setDone(false); setSubmitting(false); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(`${first.path.join(".")}: ${first.message}`);
      return;
    }
    setSubmitting(true);
    try {
      await supabase.functions.invoke("submit-application", {
        body: { listing_id: listingId, link_group_id: linkGroupId ?? null, intent, data: parsed.data },
      });
      setDone(true);
    } catch {
      toast.error("Submission failed — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setTimeout(reset, 200); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
        {done ? (
          <div className="py-10 text-center space-y-4 animate-in fade-in zoom-in-95">
            <CheckCircle2 className="w-14 h-14 text-success mx-auto" />
            <h2 className="text-2xl font-semibold text-primary">Form recorded</h2>
            <p className="font-sans-ui text-muted-foreground">
              {intent === "tour"
                ? "Contact the landlord to fix the appointment."
                : "Contact the landlord to complete the application."}
            </p>
            <Button onClick={() => onOpenChange(false)} className="font-sans-ui">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl">
                {intent === "tour" ? "Schedule a tour" : "Rental application"}
              </DialogTitle>
              <DialogDescription className="font-sans-ui">
                Submission goes directly to the landlord. All info confidential.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4 font-sans-ui mt-2">
              {fields.map(f => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={f.key} className="text-sm">{f.label}</Label>
                  {f.options ? (
                    <Select value={form[f.key] ?? ""} onValueChange={(v) => update(f.key, v)}>
                      <SelectTrigger id={f.key}><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        {f.options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : f.textarea ? (
                    <Textarea id={f.key} value={form[f.key] ?? ""} onChange={(e) => update(f.key, e.target.value)} rows={3} />
                  ) : (
                    <Input id={f.key} type={f.type ?? "text"} value={form[f.key] ?? ""} onChange={(e) => update(f.key, e.target.value)} />
                  )}
                </div>
              ))}
              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting} className="bg-primary hover:bg-primary/90">
                  {submitting ? "Submitting…" : intent === "tour" ? "Request tour" : "Submit application"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
