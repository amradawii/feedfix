import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App';

describe('App', () => {
  it('renders the page shell and step navigation', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'FeedFix' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 Upload/i })).toBeInTheDocument();
    expect(screen.getByText(/Files never leave your device\./i)).toBeInTheDocument();
  });
});
