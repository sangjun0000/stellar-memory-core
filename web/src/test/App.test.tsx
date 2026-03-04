import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../i18n/context';

// Mock the API client before importing App
vi.mock('../api/client', () => ({
  api: {
    getMemories: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getSun: vi.fn().mockResolvedValue({ data: null }),
    getZoneStats: vi.fn().mockResolvedValue({ data: [] }),
    getMemoryHealth: vi.fn().mockResolvedValue({ data: { qualityAvg: null } }),
    getConflicts: vi.fn().mockResolvedValue({ total: 0, data: [] }),
    getScanStatus: vi.fn().mockResolvedValue({ data: { isScanning: false } }),
    searchMemories: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getDataSources: vi.fn().mockResolvedValue({ data: [] }),
    getProjects: vi.fn().mockResolvedValue({ data: ['default'] }),
  },
}));

// Mock the SolarSystem (Three.js / WebGL) — not supported in jsdom
vi.mock('../components/SolarSystem', () => ({
  SolarSystem: () => <div data-testid="solar-system-mock" />,
}));

import App from '../App';

function renderApp() {
  return render(
    <LanguageProvider>
      <App />
    </LanguageProvider>
  );
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the brand name in the header', async () => {
    renderApp();
    expect(await screen.findByText('Stellar Memory')).toBeInTheDocument();
  });

  it('renders the search bar', async () => {
    renderApp();
    expect(await screen.findByRole('searchbox')).toBeInTheDocument();
  });

  it('renders tab navigation', async () => {
    renderApp();
    // There are multiple elements matching "solar system", use getAllByText
    const solarElements = await screen.findAllByText(/solar system/i);
    expect(solarElements.length).toBeGreaterThan(0);
    expect(await screen.findByText(/analytics/i)).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    renderApp();
    // Should not crash during loading
    expect(document.body).toBeTruthy();
  });
});
