import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const Forbidden = () => (
  <main className="min-h-screen bg-secondary/30 flex items-center justify-center px-6 py-12">
    <Card className="max-w-md w-full p-8 text-center shadow-soft">
      <h1 className="text-3xl font-semibold text-destructive mb-3">403 · Forbidden</h1>
      <p className="font-sans-ui text-muted-foreground mb-6">
        You don't have access to this page. Tenant and admin links must be opened with the full URL provided to you.
      </p>
      <Button asChild variant="outline" className="font-sans-ui"><Link to="/">Go home</Link></Button>
    </Card>
  </main>
);

export default Forbidden;
