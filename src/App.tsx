export default function App() {
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-6xl items-baseline justify-between px-6 py-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900">FeedFix</h1>
            <p className="text-sm text-neutral-500">
              Clean and convert product CSV files in your browser.
            </p>
          </div>
          <nav aria-label="Steps" className="text-sm text-neutral-500">
            <span className="font-medium text-neutral-900">1 Upload</span>
            <span className="mx-2 text-neutral-300" aria-hidden="true">
              &middot;
            </span>
            <span>2 Problems</span>
            <span className="mx-2 text-neutral-300" aria-hidden="true">
              &middot;
            </span>
            <span>3 Review</span>
            <span className="mx-2 text-neutral-300" aria-hidden="true">
              &middot;
            </span>
            <span>4 Export</span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <section className="rounded-lg border border-neutral-200 p-8 text-center">
          <p className="text-neutral-700">
            Drop a Shopify, WooCommerce or Google Merchant Center CSV file to check it locally.
          </p>
          <p className="mt-2 text-sm text-neutral-500">Files never leave your device.</p>
        </section>
      </main>
    </div>
  );
}
