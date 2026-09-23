// Must run before imports that can parse protocol schemas so CSP never needs unsafe-eval.
import './app/schema-runtime';
import { createRoot } from 'react-dom/client';
import App from './app/App';

createRoot(document.getElementById('root')!).render(<App />);
