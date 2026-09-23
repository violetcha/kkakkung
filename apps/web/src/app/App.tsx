import { lazy, Suspense, useEffect, useState } from 'react';
import {
  consumeDemoSession,
  consumeInvitation,
  consumeShowcaseSession,
  invitationRoom,
} from '../features/room/product-session';
import { DemoAdminApp } from './DemoAdminApp';
import { ShowcaseApp } from './ShowcaseApp';
import { ProductApp } from './ProductApp';
import '../styles.css';

const isDemoAdmin = window.location.pathname === '/demo' || window.location.pathname === '/demo/';
// 발표 시연 방 진입 페이지. 데모처럼 홈과 분리되어 있고 SSO 뒤에서만 열린다.
const isShowcase =
  window.location.pathname === '/showcase' || window.location.pathname === '/showcase/';
const isDiagnostic =
  !isDemoAdmin &&
  !isShowcase &&
  import.meta.env.DEV &&
  window.location.pathname !== '/play' &&
  !window.location.hash;
const DevelopmentApp = import.meta.env.DEV ? lazy(() => import('./DevelopmentApp')) : null;
const PreviewApp = import.meta.env.DEV ? lazy(() => import('./PreviewApp')) : null;
// 조각은 아래에서 소비되며 지워지므로, 초대 방 코드는 그 전에 읽어 둔다.
const entryHash = window.location.hash;
// S15P21C204-260. Operator demo entry, consumed before the invitation so its fragment is cleared.
const demoSession =
  isDemoAdmin || isShowcase ? null : consumeDemoSession(window.location, window.history);
const showcaseSession =
  isDemoAdmin || isShowcase || demoSession
    ? null
    : consumeShowcaseSession(window.location, window.history);
// S15P21C204-363. 시연·데모 조각의 `room=` 은 그 세션의 방이지 초대 방 코드가 아니다. 입장 폼에
// "친구 방 참가 + 방 코드" 로 미리 채워지지 않게 한다.
const initialRoom =
  isDemoAdmin || isShowcase || demoSession || showcaseSession ? '' : invitationRoom(entryHash);
const invitation =
  isDemoAdmin || isShowcase || demoSession || showcaseSession
    ? ''
    : consumeInvitation(window.location, window.history);
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
  if (isShowcase) return <ShowcaseApp />;
  return navigation.isDiagnostic && DevelopmentApp ? (
    <Suspense fallback={<p>불러오는 중…</p>}>
      <DevelopmentApp />
    </Suspense>
  ) : (
    <ProductApp
      invitation={navigation.invitation}
      initialRoom={navigation.initialRoom}
      {...(demoSession ? { demoSession } : {})}
      {...(showcaseSession ? { showcaseSession } : {})}
    />
  );
}
