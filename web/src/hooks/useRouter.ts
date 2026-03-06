import { useState, useEffect, useCallback } from 'react';

/**
 * Minimal client-side router using the History API.
 * Supports clean URLs ("/", "/dashboard") without any external library.
 */

export type Route = '/' | '/dashboard';

function getRoute(): Route {
  const path = window.location.pathname;
  if (path.startsWith('/dashboard')) return '/dashboard';
  return '/';
}

export function useRouter() {
  const [route, setRoute] = useState<Route>(getRoute);

  // Listen for back/forward browser navigation
  useEffect(() => {
    const handlePop = () => setRoute(getRoute());
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const navigate = useCallback((to: Route) => {
    if (window.location.pathname !== to) {
      history.pushState(null, '', to);
    }
    setRoute(to);
  }, []);

  return { route, navigate };
}
