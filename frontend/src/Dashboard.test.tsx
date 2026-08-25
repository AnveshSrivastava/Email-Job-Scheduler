import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { apiClient } from './api/client';
import { fireEvent } from '@testing-library/react';

vi.mock('./api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    defaults: { baseURL: 'http://localhost:3000/api/v1' },
  },
}));

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders create sender form if no senders exist', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/senders') return Promise.resolve({ data: { data: [] } });
      if (url === '/campaigns') return Promise.resolve({ data: { data: [] } });
      return Promise.resolve({ data: { data: [] } });
    });

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    // Switch to create tab
    fireEvent.click(await screen.findByText(/New Campaign/i));

    expect(await screen.findByText(/Create Your First Sender/i)).toBeInTheDocument();
    expect(screen.getByText(/Sender Email/i)).toBeInTheDocument();
  });

  it('renders sender dropdown if senders exist', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/senders')
        return Promise.resolve({
          data: {
            data: [{ id: 'sender-1', email: 'test@example.com', displayName: 'Test Sender' }],
          },
        });
      if (url === '/campaigns') return Promise.resolve({ data: { data: [] } });
      return Promise.resolve({ data: { data: [] } });
    });

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>,
    );

    // Switch to create tab
    fireEvent.click(await screen.findByText(/New Campaign/i));

    await waitFor(() => {
      expect(screen.getByText(/Test Sender <test@example.com>/i)).toBeInTheDocument();
    });

    // Verify dropdown is rendered instead of create form
    expect(screen.queryByText(/Create Your First Sender/i)).not.toBeInTheDocument();
  });
});
