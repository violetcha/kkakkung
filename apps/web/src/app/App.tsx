import { lazy, Suspense, useEffect, useState } from 'react';
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
  const [navigation, setNavigation] = useState({ invitation, initialRoom, isDiagnostic });
  useEffect(() => {
    const changed = () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      if (!params.has('invite') && !params.has('inviteToken')) return;
      const room = invitationRoom(window.location.hash);
      setNavigation({
        invitation: consumeInvitation(window.location, window.history),
        initialRoom: room,
        isDiagnostic: false,
      });
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  if (import.meta.env.DEV && window.location.pathname === '/preview' && PreviewApp)
    return (
      <Suspense fallback={<p>불러오는 중…</p>}>
        <PreviewApp />
      </Suspense>
    );
  return navigation.isDiagnostic && DevelopmentApp ? (
    <Suspense fallback={<p>불러오는 중…</p>}>
      <DevelopmentApp />
    </Suspense>
  ) : (
    <ProductApp invitation={navigation.invitation} initialRoom={navigation.initialRoom} />
  );
}
