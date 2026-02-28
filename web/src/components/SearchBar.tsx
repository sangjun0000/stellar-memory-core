import { useState, useCallback } from 'react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  isSearching: boolean;
  resultCount?: number;
}

export function SearchBar({ onSearch, isSearching, resultCount }: SearchBarProps) {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (value.trim()) onSearch(value.trim());
    },
    [value, onSearch]
  );

  const handleClear = useCallback(() => {
    setValue('');
    onSearch('');
  }, [onSearch]);

  return (
    <form onSubmit={handleSubmit} className="relative flex items-center gap-2">
      <div className="relative flex-1">
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search memories..."
          className="w-full bg-space-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500 pr-8"
          aria-label="Search memories"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      <button
        type="submit"
        disabled={!value.trim() || isSearching}
        className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-white transition-colors"
      >
        {isSearching ? '...' : 'Search'}
      </button>

      {resultCount !== undefined && (
        <span className="text-xs text-gray-500 whitespace-nowrap">
          {resultCount} found
        </span>
      )}
    </form>
  );
}
