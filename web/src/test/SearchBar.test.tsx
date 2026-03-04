import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchBar } from '../components/SearchBar';
import { LanguageProvider } from '../i18n/context';

function renderWithProviders(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('SearchBar', () => {
  const onSearch = vi.fn();

  beforeEach(() => {
    onSearch.mockClear();
  });

  it('renders the search input', () => {
    renderWithProviders(
      <SearchBar onSearch={onSearch} isSearching={false} />
    );
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('renders the search button', () => {
    renderWithProviders(
      <SearchBar onSearch={onSearch} isSearching={false} />
    );
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });

  it('shows result count when provided', () => {
    renderWithProviders(
      <SearchBar onSearch={onSearch} isSearching={false} resultCount={42} />
    );
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('shows "Scanning" text when isSearching is true', () => {
    renderWithProviders(
      <SearchBar onSearch={onSearch} isSearching={true} />
    );
    expect(screen.getByText(/scanning/i)).toBeInTheDocument();
  });

  it('calls onSearch with empty query when clear button is clicked', () => {
    renderWithProviders(
      <SearchBar onSearch={onSearch} isSearching={false} />
    );

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'test query' } });

    const clearButton = screen.getByRole('button', { name: /clear/i });
    fireEvent.click(clearButton);

    expect(onSearch).toHaveBeenCalledWith({ query: '' });
  });

  it('calls onSearch with query on form submit', () => {
    renderWithProviders(
      <SearchBar onSearch={onSearch} isSearching={false} />
    );

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'my query' } });

    const form = input.closest('form')!;
    fireEvent.submit(form);

    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'my query' })
    );
  });

  it('renders type and zone filter dropdowns', () => {
    renderWithProviders(
      <SearchBar onSearch={onSearch} isSearching={false} />
    );
    expect(screen.getByRole('combobox', { name: /filter by type/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /filter by zone/i })).toBeInTheDocument();
  });
});
