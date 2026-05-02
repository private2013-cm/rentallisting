const Landing = () => {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6 py-16">
      <div className="max-w-2xl text-center">
        <span className="inline-block px-4 py-1.5 rounded-full bg-muted text-xs tracking-[0.2em] uppercase text-muted-foreground mb-8">
          Private Landlord Rentals
        </span>
        <h1 className="font-serif text-5xl md:text-6xl leading-tight text-primary mb-8">
          Contact Landlord for Rental Properties
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          Browse rental listings shared by private landlords. Use the link your
          landlord sent you to view details and apply for the property.
        </p>
      </div>
    </main>
  );
};

export default Landing;
