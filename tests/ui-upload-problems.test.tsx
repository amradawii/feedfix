import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App';

describe('upload step and grouped problems overview', () => {
  it('shows the Why not just ask a chatbot section before upload and runs checks on sample upload', async () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Why not just ask a chatbot?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'AI is great for writing product descriptions. FeedFix makes sure the file is correct.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Shopify sample/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Problems found' })).toBeInTheDocument();
    });

    // Detection bar displays format, row count, product count, encoding, delimiter
    expect(screen.getByText(/8 rows/)).toBeInTheDocument();
    expect(screen.getByText(/5 products/)).toBeInTheDocument();

    // Grouped problems appear with plain-English titles
    expect(screen.getByText('Price has text in it')).toBeInTheDocument();
    expect(
      screen.getByText('Barcode turned into scientific notation (unrecoverable)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Broken text encoding (mojibake)')).toBeInTheDocument();

    // Severity filter works
    fireEvent.click(screen.getByRole('button', { name: /^Tips \(/i }));
    expect(screen.queryByText('Price has text in it')).not.toBeInTheDocument();
    expect(screen.getByText('Link uses http:// instead of https://')).toBeInTheDocument();

    // Reset filter and queue all safe fixes
    fireEvent.click(screen.getByRole('button', { name: /^All \(/i }));
    fireEvent.click(screen.getByRole('button', { name: /Fix all safe/i }));
    expect(screen.getByRole('button', { name: /safe fixes queued/i })).toBeDisabled();
  });

  it('supports overriding the detected platform format via the dropdown', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /WooCommerce sample/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Detected platform format')).toHaveValue('woocommerce');
    });

    fireEvent.change(screen.getByLabelText('Detected platform format'), {
      target: { value: 'other' },
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Detected platform format')).toHaveValue('other');
    });
  });
});
