import { lazy, Suspense, useEffect, useState } from 'react';
import {
  consumeDemoSession,
  consumeInvitation,
  invitationRoom,
} from '../features/room/product-session';
import { DemoAdminApp } from './DemoAdminApp';
import { ProductApp } from './ProductApp';
import '../styles.css';

const isDemoAdmin = window.location.pathname === '/demo' || window.location.pathname === '/demo/';
const isDiagnostic =
  !isDemoAdmin &&
  import.meta.env.DEV &&
  window.location.pathname !== '/play' &&
  !window.location.hash;
const DevelopmentApp = import.meta.env.DEV ? lazy(() => import('./DevelopmentApp')) : null;
const PreviewApp = import.meta.env.DEV ? lazy(() => import('./PreviewApp')) : null;
const initialRoom = isDemoAdmin ? '' : invitationRoom(window.location.hash);
// S15P21C204-260. Operator demo entry, consumed before the invitation so its fragment is cleared.
const demoSession = isDemoAdmin ? null : consumeDemoSession(window.location, window.history);
const invitation =
  isDemoAdmin || demoSession ? '' : consumeInvitation(window.location, window.history);
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
  if (isDemoAdmin) return <DemoAdminApp />;
  return navigation.isDiagnostic && DevelopmentApp ? (
    <Suspense fallback={<p>불러오는 중…</p>}>
      <DevelopmentApp />
    </Suspense>
  ) : (
    <ProductApp
      invitation={navigation.invitation}
      initialRoom={navigation.initialRoom}
      {...(demoSession ? { demoSession } : {})}
    />
  );
}
