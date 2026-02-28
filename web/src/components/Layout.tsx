import type { ReactNode } from 'react';

interface LayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
  detail: ReactNode | null;
}

export function Layout({ sidebar, main, detail }: LayoutProps) {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex-shrink-0 h-10 bg-space-900 border-b border-gray-800 flex items-center px-4 gap-3">
        <div className="flex items-center gap-2">
          <span className="text-yellow-400 text-base">★</span>
          <span className="text-sm font-semibold text-gray-200 tracking-wide">Stellar Memory</span>
        </div>
        <span className="text-gray-600 text-xs">Solar System Dashboard</span>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <aside className="flex-shrink-0 w-52 bg-space-900 border-r border-gray-800 overflow-y-auto p-2 space-y-2">
          {sidebar}
        </aside>

        {/* Main canvas */}
        <main className="flex-1 relative overflow-hidden">{main}</main>

        {/* Right detail panel */}
        {detail && (
          <aside className="flex-shrink-0 w-72 bg-space-900 border-l border-gray-800 overflow-hidden">
            {detail}
          </aside>
        )}
      </div>
    </div>
  );
}
