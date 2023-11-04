import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App';

describe('App', () => {
  it('renders the page shell and step navigation', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'FeedFix' })).toBeInTheDocument();
    expect(screen.getByText('1 Upload')).toBeInTheDocument();
    expect(screen.getByText('Files never leave your device.')).toBeInTheDocument();
  });
});
