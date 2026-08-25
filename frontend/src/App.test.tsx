import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App Component', () => {
  it('renders the application header', () => {
    render(<App />);
    const headingElement = screen.getByText(/ReachInbox Email Scheduler/i);
    expect(headingElement).toBeInTheDocument();
  });
});
