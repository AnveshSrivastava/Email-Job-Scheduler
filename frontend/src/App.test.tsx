import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

vi.mock('./api/client', () => ({
  apiClient: {
    get: vi.fn().mockRejectedValue(new Error('Unauthenticated')),
    defaults: { baseURL: 'http://localhost:3000/api/v1' }
  }
}));

describe('App', () => {
  it('renders login page by default', async () => {
    render(<App />);
    expect(await screen.findByText(/ReachInbox/i)).toBeInTheDocument();
    expect(await screen.findByText(/Continue with Google/i)).toBeInTheDocument();
  });
});
