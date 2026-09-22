import { useState, type FormEvent } from 'react';
import { requestDemoRoom } from '../features/room/product-session';
import { BrandLogo } from './BrandLogo';

const messageFor = (error: unknown) => {
  if (!(error instanceof Error)) return '데모 방을 열지 못했습니다. 잠시 후 다시 시도해 주세요.';
  switch (error.message) {
    case 'DEMO_REQUEST_FAILED:401':
      return '관리자 권한을 확인하지 못했습니다. 다시 로그인해 주세요.';
    case 'DEMO_REQUEST_FAILED:503':
      return '데모 방을 지금 열 수 없습니다. 진행 중인 데모를 종료하거나 운영 설정을 확인해 주세요.';
    default:
      return '데모 방을 열지 못했습니다. 네트워크와 운영 상태를 확인한 뒤 다시 시도해 주세요.';
  }
};

/** GitLab SSO로 보호된 `/demo` 전용 관리자 화면. 일반 게임 입장·운영 토큰과 분리한다. */
export function DemoAdminApp() {
  const [role, setRole] = useState<'runner' | 'tagger'>('runner');
  const [nickname, setNickname] = useState('관리자');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const openDemo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const demo = await requestDemoRoom({
        role,
        ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
      });
      // The one-use player session must reach the game page once. ProductApp clears this fragment
      // from the history before it connects, so it is never kept in a bookmarked admin address.
      window.location.assign('/play' + demo.entryFragment);
    } catch (reason) {
      setError(messageFor(reason));
      setSubmitting(false);
    }
  };

  return (
    <main className="demo-admin-shell">
      <header>
        <BrandLogo />
        <p>관리자 전용</p>
      </header>
      <section className="demo-admin-card" aria-labelledby="demo-admin-title">
        <p className="eyebrow">OPERATOR CONSOLE</p>
        <h2 id="demo-admin-title">데모 방 열기</h2>
        <p>
          인형 다섯 명과 실제 규칙으로 진행하는 시연 방을 엽니다. 일반 게임 이용자는 이 페이지나
          관리자 권한에 접근할 수 없습니다.
        </p>
        <form onSubmit={openDemo}>
          <label htmlFor="demo-nickname">
            화면 표시 이름
            <input
              id="demo-nickname"
              value={nickname}
              maxLength={20}
              onChange={(event) => setNickname(event.target.value)}
              disabled={submitting}
            />
          </label>
          <fieldset disabled={submitting}>
            <legend>관리자 역할</legend>
            <label>
              <input
                type="radio"
                name="demo-role"
                checked={role === 'runner'}
                onChange={() => setRole('runner')}
              />
              도망자
            </label>
            <label>
              <input
                type="radio"
                name="demo-role"
                checked={role === 'tagger'}
                onChange={() => setRole('tagger')}
              />
              술래
            </label>
          </fieldset>
          <button type="submit" disabled={submitting}>
            {submitting ? '데모 방을 여는 중…' : '데모 시작'}
          </button>
        </form>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <a href="/">일반 게임으로 돌아가기</a>
      </section>
    </main>
  );
}
