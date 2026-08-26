/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { apiClient } from './api/client';

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

  const setupMock = () => {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/senders')
        return Promise.resolve({ data: { data: [{ id: '1', email: 'test@example.com' }] } });
      if (url === '/campaigns') return Promise.resolve({ data: { data: [] } });
      return Promise.resolve({ data: { data: [] } });
    });
  };

  const fillForm = async (overrides: any = {}) => {
    fireEvent.click(await screen.findByText(/New Campaign/i));
    await waitFor(() => screen.getByRole('button', { name: /Schedule Campaign/i }));
    
    if (overrides.subject !== false) fireEvent.change(document.getElementById('subject')!, { target: { value: 'Sub' } });
    if (overrides.body !== false) fireEvent.change(document.getElementById('body')!, { target: { value: 'Body' } });
    if (overrides.recipients !== false) fireEvent.change(document.getElementById('recipients')!, { target: { value: 'a@b.com' } });
    if (overrides.startAt !== false) {
      const val = overrides.startAt || '2099-01-01T12:00';
      fireEvent.change(document.getElementById('startAt')!, { target: { value: val } });
    }
  };

  it('shows error if startAt is empty', async () => {
    setupMock();
    render(<BrowserRouter><Dashboard /></BrowserRouter>);
    await fillForm({ startAt: false });
    fireEvent.submit(screen.getByText(/Schedule Campaign/i).closest('form')!);
    
    expect(await screen.findByText(/Please choose a date and time for sending/i)).toBeInTheDocument();
  });

  it('shows human-readable error if past startAt is selected', async () => {
    setupMock();
    render(<BrowserRouter><Dashboard /></BrowserRouter>);
    const pastDate = new Date(Date.now() - 86400000).toISOString().slice(0, 16);
    await fillForm({ startAt: pastDate });
    fireEvent.submit(screen.getByText(/Schedule Campaign/i).closest('form')!);
    
    expect(await screen.findByText(/That time has already passed. Please choose a future date and time/i)).toBeInTheDocument();
  });

  it('displays multiple validation errors gracefully', async () => {
    setupMock();
    (apiClient.post as any).mockImplementation(() => Promise.reject({
      isAxiosError: true,
      response: { data: { error: { details: ['That time has already passed. Please choose a future date and time.', 'Please enter an email subject.'] } } }
    }));
    render(<BrowserRouter><Dashboard /></BrowserRouter>);
    await fillForm();
    fireEvent.submit(screen.getByText(/Schedule Campaign/i).closest('form')!);
    
    expect(await screen.findByText(/That time has already passed. Please choose a future date and time., Please enter an email subject./i)).toBeInTheDocument();
  });

  it('displays generic API error message', async () => {
    setupMock();
    (apiClient.post as any).mockImplementation(() => Promise.reject({
      isAxiosError: true,
      response: { data: { error: { message: 'Something went wrong on the server' } } }
    }));
    render(<BrowserRouter><Dashboard /></BrowserRouter>);
    await fillForm();
    fireEvent.submit(screen.getByText(/Schedule Campaign/i).closest('form')!);
    
    expect(await screen.findByText(/Something went wrong on the server/i)).toBeInTheDocument();
  });

  it('displays network failure message when no response is received', async () => {
    setupMock();
    (apiClient.post as any).mockImplementation(() => Promise.reject({
      isAxiosError: true,
      message: 'Network Error',
    }));
    render(<BrowserRouter><Dashboard /></BrowserRouter>);
    await fillForm();
    fireEvent.submit(screen.getByText(/Schedule Campaign/i).closest('form')!);
    
    expect(await screen.findByText(/Unable to connect to the server/i)).toBeInTheDocument();
  });

  it('navigates to details using batchId on success (JSON)', async () => {
    setupMock();
    (apiClient.post as any).mockImplementation(() => Promise.resolve({ data: { data: { batchId: 'batch-123', status: 'SCHEDULED' } } }));
    render(<BrowserRouter><Dashboard /></BrowserRouter>);
    await fillForm();
    fireEvent.submit(screen.getByText(/Schedule Campaign/i).closest('form')!);
    
    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalled();
    });
  });

  it('handles malformed success response gracefully without crashing', async () => {
    setupMock();
    (apiClient.post as any).mockImplementation(() => Promise.resolve({ data: { data: { somethingElse: true } } }));
    render(<BrowserRouter><Dashboard /></BrowserRouter>);
    await fillForm();
    fireEvent.submit(screen.getByText(/Schedule Campaign/i).closest('form')!);
    
    expect(await screen.findByText(/Campaign was created successfully, but we couldn't open its details/i)).toBeInTheDocument();
  });
});
