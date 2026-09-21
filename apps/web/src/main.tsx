// S15P21C204-303. 이 import 가 맨 앞이어야 한다. 아래 import 들이 평가되기 전에 Zod 의
// JIT 를 꺼야 브라우저 CSP 에서 `'unsafe-eval'` 없이 돌아간다. 자세한 이유는 그 파일에.
import './app/schema-runtime';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
