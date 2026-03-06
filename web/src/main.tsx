import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import { LanguageProvider } from './i18n/context';
import { useRouter } from './hooks/useRouter';
import { LandingPage } from './components/LandingPage';
import App from './App';

function Root() {
  const { route, navigate } = useRouter();

  if (route === '/') {
    return (
      <LandingPage onNavigateDashboard={() => navigate('/dashboard')} />
    );
  }

  return (
    <LanguageProvider>
      <App />
    </LanguageProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
