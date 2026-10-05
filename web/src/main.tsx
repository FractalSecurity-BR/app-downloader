import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { useRoute } from './lib/router';
import { AppsScreen } from './screens/AppsScreen';
import { ExpiredScreen } from './screens/ExpiredScreen';
import { LoginScreen } from './screens/LoginScreen';
import { SystemsScreen } from './screens/SystemsScreen';
import './styles.css';

function App() {
  const route = useRoute();
  switch (route.name) {
    case 'login':
      return <LoginScreen key={route.system} systemId={route.system} />;
    case 'apps':
      return <AppsScreen key={route.system} systemId={route.system} />;
    case 'expired':
      return <ExpiredScreen reason={route.reason} />;
    default:
      return <SystemsScreen />;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
