import { useState, type FormEvent } from 'react';
import { requestShowcaseRoom } from '../features/room/product-session';
import { BrandLogo } from './BrandLogo';

/** 시연 발급 실패를 사람이 읽을 문구로. 메시지는 `SHOWCASE_REQUEST_FAILED:<상태>[:<코드>]` 꼴이다. */
export const showcaseEntryMessage = (error: unknown) => {
  if (!(error instanceof Error))
    return '시연 방에 들어가지 못했습니다. 잠시 후 다시 시도해 주세요.';
  if (!error.message.startsWith('SHOWCASE_REQUEST_FAILED:'))
    return '시연 방에 들어가지 못했습니다. 네트워크와 로그인 상태를 확인한 뒤 다시 시도해 주세요.';
  const [, status, code] = error.message.split(':');
  // S15P21C204-362. 서버가 입장을 받지 않는 동안은 일반 입장과 같은 문구로 알린다. 방이 찬 것과 다르다.
  if (code === 'ADMISSION_CLOSED')
    return '지금은 입장을 받고 있지 않습니다. 서버가 준비되면 다시 시도해 주세요.';
  switch (status) {
    case '401':
      return '팀원 로그인을 확인하지 못했습니다. 다시 로그인해 주세요.';
    case '409':
      return '그 역할은 이미 두 명이 골랐습니다. 다른 역할을 골라 주세요.';
    case '503':
      return '시연 방을 지금 열 수 없습니다. 열려 있는 방이 가득 찼거나 운영 설정이 꺼져 있습니다.';
    default:
      return '시연 방에 들어가지 못했습니다. 네트워크와 로그인 상태를 확인한 뒤 다시 시도해 주세요.';
  }
};

/**
 * 발표 시연 방 진입 화면. `/showcase` 를 연 팀원 넷이 역할을 골라 같은 방에 모인다.
 * 데모 관리자 화면과 같은 SSO 경계 뒤에 있고, 운영 토큰이나 방 코드는 필요 없다.
 */
export function ShowcaseApp() {
  const [role, setRole] = useState<'runner' | 'tagger'>('runner');
  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const enter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const seat = await requestShowcaseRoom({
        role,
        ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
      });
      // 일회용 세션은 게임 페이지에 한 번 닿아야 한다. ProductApp 이 접속 전에 조각을 지운다.
      window.location.assign('/play' + seat.entryFragment);
    } catch (reason) {
      setError(showcaseEntryMessage(reason));
      setSubmitting(false);
    }
  };

  return (
    <main className="demo-admin-shell">
      <header>
        <BrandLogo />
        <p>발표 시연</p>
      </header>
      <section className="demo-admin-card" aria-labelledby="showcase-title">
        <p className="eyebrow">SHOWCASE</p>
        <h2 id="showcase-title">시연 방 입장</h2>
        <p>
          팀원 넷이 2:2로 뛰는 시연 방입니다. 이 주소를 연 사람은 모두 같은 방에 모이고, 맵은 16x16
          소형 미로로 고정되며 3분을 끝까지 진행합니다.
        </p>
        <form onSubmit={enter}>
          <label htmlFor="showcase-nickname">
            화면 표시 이름
            <input
              id="showcase-nickname"
              value={nickname}
              maxLength={20}
              placeholder={role === 'runner' ? '도망자' : '술래'}
              onChange={(event) => setNickname(event.target.value)}
              disabled={submitting}
            />
          </label>
          <fieldset disabled={submitting}>
            <legend>내 역할</legend>
            <label>
              <input
                type="radio"
                name="showcase-role"
                checked={role === 'runner'}
                onChange={() => setRole('runner')}
              />
              도망자
            </label>
            <label>
              <input
                type="radio"
                name="showcase-role"
                checked={role === 'tagger'}
                onChange={() => setRole('tagger')}
              />
              술래
            </label>
          </fieldset>
          <button type="submit" disabled={submitting}>
            {submitting ? '시연 방에 들어가는 중…' : '시연 방 입장'}
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
