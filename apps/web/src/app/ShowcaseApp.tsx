import { useState, type FormEvent } from 'react';
import {
  SHOWCASE_SEATS,
  SHOWCASE_SEAT_LABELS,
  type ShowcaseSeat,
} from '@kkakkung/protocol/game-messages';
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
      return '그 자리에는 이미 누가 앉았습니다. 다른 자리를 골라 주세요.';
    case '503':
      return '시연 방을 지금 열 수 없습니다. 열려 있는 방이 가득 찼거나 운영 설정이 꺼져 있습니다.';
    default:
      return '시연 방에 들어가지 못했습니다. 네트워크와 로그인 상태를 확인한 뒤 다시 시도해 주세요.';
  }
};

/**
 * 발표 시연 방 진입 화면. `/showcase` 를 연 팀원 넷이 자리를 골라 같은 방에 모인다.
 * 데모 관리자 화면과 같은 SSO 경계 뒤에 있고, 운영 토큰이나 방 코드는 필요 없다.
 *
 * S15P21C204-403. 자리(도망자 1·2, 술래 1·2)마다 시작 칸·출구가 고정이라 발표 대본은 자리별로
 * 쓰인다. 역할만 고르면 자리 번호가 제출 순서로 정해져 대본과 엇갈리므로 자리를 직접 고른다.
 * 표시 이름은 자리 이름이고 따로 받지 않는다.
 */
export function ShowcaseApp() {
  const [seat, setSeat] = useState<ShowcaseSeat>('runner-1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const enter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const issued = await requestShowcaseRoom({ seat });
      // 일회용 세션은 게임 페이지에 한 번 닿아야 한다. ProductApp 이 접속 전에 조각을 지운다.
      window.location.assign('/play' + issued.entryFragment);
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
          소형 미로로 고정되며 3분을 끝까지 진행합니다. 자리마다 시작 위치와 출구가 정해져 있으니
          대본의 자리를 고르세요.
        </p>
        <form onSubmit={enter}>
          <fieldset disabled={submitting}>
            <legend>내 자리</legend>
            {SHOWCASE_SEATS.map((candidate) => (
              <label key={candidate}>
                <input
                  type="radio"
                  name="showcase-seat"
                  value={candidate}
                  checked={seat === candidate}
                  onChange={() => setSeat(candidate)}
                />
                {SHOWCASE_SEAT_LABELS[candidate]}
              </label>
            ))}
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
