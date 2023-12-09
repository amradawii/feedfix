export function WhyNotChatbot() {
  const points = [
    {
      lead: 'Never invents data.',
      body: 'No made-up barcodes, prices or categories.',
    },
    {
      lead: 'Handles big files.',
      body: '100,000 rows, nothing skipped or summarised.',
    },
    {
      lead: 'Knows exact platform rules.',
      body: 'Column names and allowed values for each platform.',
    },
    {
      lead: 'Real checks.',
      body: 'Barcode check digits, duplicates and encodings are calculated, not guessed.',
    },
    {
      lead: 'Every change is visible.',
      body: 'Review before and after, accept or reject.',
    },
    {
      lead: 'Private and repeatable.',
      body: 'Files stay on your device; the same file gives the same result.',
    },
  ];

  return (
    <section
      aria-labelledby="why-not-chatbot-heading"
      className="mt-12 border-t border-neutral-200 pt-8"
    >
      <h2 id="why-not-chatbot-heading" className="text-base font-semibold text-neutral-900">
        Why not just ask a chatbot?
      </h2>
      <ul className="mt-4 grid gap-x-8 gap-y-2.5 text-sm text-neutral-700 sm:grid-cols-2">
        {points.map((item) => (
          <li key={item.lead}>
            <strong className="font-medium text-neutral-900">{item.lead}</strong> {item.body}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-neutral-600">
        AI is great for writing product descriptions. FeedFix makes sure the file is correct.
      </p>
    </section>
  );
}
