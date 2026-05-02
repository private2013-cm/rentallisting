// Application form (used by both Apply now & Schedule a tour).
import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { z } from "zod";
import { toast } from "sonner";

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(100),
  email: z.string().trim().email("Invalid email").max(200),
  phone: z.string().trim().min(5, "Required").max(40),
  age: z.string().trim().max(3),
  current_address: z.string().trim().max(300),
  monthly_income: z.string().trim().max(40),
  lease_duration: z.string().trim().max(60),
  bedrooms_desired: z.string().trim().max(10),
  bathrooms_desired: z.string().trim().max(10),
  adults_moving_in: z.string().trim().max(10),
  smoke: z.string().trim().max(20),
  pet: z.string().trim().max(60),
  car: z.string().trim().max(20),
  reasons_for_moving: z.string().trim().max(500),
  criminal_record: z.string().trim().max(60),
  agrees: z.string().trim().max(20),
  payment_method: z.string().trim().max(40),
});

const fields: Array<{ key: keyof z.infer<typeof schema>; label: string; type?: string; options?: string[]; textarea?: boolean }> = [
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
  { key: "pet", label: "🐶 Do you have a pet? (type/breed if yes)" },
  { key: "car", label: "🚗 Do you have a car?", options: ["Yes", "No"] },
  { key: "reasons_for_moving", label: "📝 Reasons for moving", textarea: true },
  { key: "criminal_record", label: "⚠️ Do you have any criminal record?", options: ["No", "Yes"] },
  { key: "agrees", label: "✅ Willing to rent and agreed to terms?", options: ["Yes", "No"] },
  { key: "payment_method", label: "💵 Application fee payment method (refundable, deducted from 1st rent)", options: ["Chime", "Apple Pay", "Zelle", "PayPal", "Venmo"] },
];

const ApplyPage = () => {
  const { listingId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const intent = searchParams.get("intent") === "tour" ? "tour" : "apply";
  const [form, setForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const update = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

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
        body: { listing_id: listingId, intent, data: parsed.data },
      });
      setDone(true);
    } catch (e) {
      toast.error("Submission failed — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <main className="min-h-screen bg-gradient-warm flex items-center justify-center px-6">
        <Card className="max-w-lg p-10 text-center space-y-4 shadow-elevated">
          <h1 className="text-3xl font-semibold text-primary">✅ Form recorded</h1>
          <p className="font-sans-ui text-muted-foreground">
            {intent === "tour"
              ? "Contact landlord to fix the appointment."
              : "Contact landlord to complete the application."}
          </p>
          <Button onClick={() => navigate(-1)} variant="outline" className="font-sans-ui">Back</Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-warm py-12 px-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold text-primary mb-2">
          {intent === "tour" ? "Schedule a tour" : "Rental application"}
        </h1>
        <p className="font-sans-ui text-muted-foreground mb-8">All fields confidential. Submission goes directly to the landlord.</p>
        <Card className="p-6 sm:p-8 shadow-soft">
          <form onSubmit={submit} className="space-y-5 font-sans-ui">
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
            <Button type="submit" disabled={submitting} size="lg" className="w-full bg-primary hover:bg-primary/90">
              {submitting ? "Submitting…" : "Submit application"}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
};

export default ApplyPage;
