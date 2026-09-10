import { lazy, Suspense } from 'react';
import { consumeInvitation, invitationRoom } from '../features/room/product-session';
import { ProductApp } from './ProductApp';
import '../styles.css';

const isDiagnostic =
  import.meta.env.DEV && window.location.pathname !== '/play' && !window.location.hash;
const DevelopmentApp = import.meta.env.DEV ? lazy(() => import('./DevelopmentApp')) : null;
const PreviewApp = import.meta.env.DEV ? lazy(() => import('./PreviewApp')) : null;
const initialRoom = invitationRoom(window.location.hash);
const invitation = consumeInvitation(window.location, window.history);
export default function App() {
  if (import.meta.env.DEV && window.location.pathname === '/preview' && PreviewApp)
    return (
      <Suspense fallback={<p>불러오는 중…</p>}>
        <PreviewApp />
      </Suspense>
    );
  return isDiagnostic && DevelopmentApp ? (
    <Suspense fallback={<p>불러오는 중…</p>}>
      <DevelopmentApp />
    </Suspense>
  ) : (
    <ProductApp invitation={invitation} initialRoom={initialRoom} />
  );
}
