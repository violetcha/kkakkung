import { useEffect, useRef, useState } from 'react';
import {
  ROOM_INVITATION_ROUTE,
  ROOM_INVITATION_ERROR_CODES,
  roomInvitationResponseSchema,
  type RoomInvitationResponse,
} from '@kkakkung/protocol/game-messages';

export function RoomInvitationControls({
  sessionToken,
  roomCode,
  teamOnly,
}: {
  sessionToken: string;
  roomCode: string;
  teamOnly: boolean;
}) {
  const [invitation, setInvitation] = useState<RoomInvitationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      pending.current?.abort();
    },
    [sessionToken, roomCode],
  );
  useEffect(() => {
    if (!invitation) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [invitation]);
  const current = invitation?.roomCode === roomCode ? invitation : null;
  const expired = current !== null && current.expiresAt <= now;
  const url = current
    ? `${window.location.origin}/#${new URLSearchParams({ invite: current.inviteToken, room: current.roomCode })}`
    : '';

  async function manage(revoke: boolean) {
    if (pending.current) return;
    const run = ++generation.current;
    const abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    setInvitation(null);
    setMessage('');
    try {
      const response = await fetch(ROOM_INVITATION_ROUTE, {
        method: revoke ? 'DELETE' : 'POST',
        headers: { authorization: `Bearer ${sessionToken}` },
        cache: 'no-store',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const code =
          typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
        throw new Error(
          ROOM_INVITATION_ERROR_CODES.some((known) => known === code) ? String(code) : 'UNKNOWN',
        );
      }
      if (response.status !== (revoke ? 204 : 201)) throw new Error('UNKNOWN');
      const next = revoke ? null : roomInvitationResponseSchema.parse(await response.json());
      if (next && next.roomCode !== roomCode) throw new Error('UNKNOWN');
      if (run !== generation.current) return;
      setInvitation(next);
      setNow(Date.now());
      setMessage(
        revoke
          ? '기존 초대 링크를 회수했습니다.'
          : '이전 링크는 사용할 수 없습니다. 새 링크를 공유해 주세요.',
      );
    } catch (error) {
      if (run !== generation.current) return;
      const labels: Record<string, string> = {
        INVALID_SESSION: '접속이 만료됐습니다. 방에 다시 참가해 주세요.',
        INVITATION_UNAVAILABLE:
          '대기 중인 방장만 초대를 관리할 수 있습니다. 방 상태를 확인해 주세요.',
        RATE_LIMITED: '잠시 후 다시 시도해 주세요.',
        ADMISSION_CLOSED: '현재 새 참가자를 받을 수 없습니다. 잠시 후 다시 시도해 주세요.',
      };
      setMessage(
        labels[error instanceof Error ? error.message : ''] ??
          '처리 결과를 확인하지 못했습니다. 다시 시도해 새 링크를 만들거나 기존 링크를 회수해 주세요.',
      );
    } finally {
      if (pending.current === abort) pending.current = null;
      if (run === generation.current) setBusy(false);
    }
  }

  async function copy() {
    if (!current || expired) return;
    const run = generation.current;
    try {
      await navigator.clipboard.writeText(url);
      if (run === generation.current) setMessage('초대 링크를 복사했습니다.');
    } catch {
      if (run === generation.current)
        setMessage('자동 복사를 사용할 수 없습니다. 아래 링크를 선택해 복사해 주세요.');
    }
  }

  return (
    <section aria-label="친구 초대 관리">
      <h3>친구 초대</h3>
      <p>새 링크를 만들면 이전 링크로는 입장할 수 없습니다. 이미 참가한 친구는 그대로 남습니다.</p>
      <button disabled={busy} onClick={() => void manage(false)}>
        {current ? '초대 링크 재발급' : '초대 링크 만들기'}
      </button>
      <button disabled={busy} onClick={() => void manage(true)}>
        기존 초대 링크 회수
      </button>
      {current && !expired && (
        <>
          <label>
            친구에게 보낼 링크
            <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <button onClick={() => void copy()}>초대 링크 복사</button>
          <p>
            약 {Math.max(1, Math.ceil((current.expiresAt - now) / 60_000))}분 동안 사용할 수
            있습니다.
          </p>
        </>
      )}
      {expired && <p role="status">초대 링크가 만료됐습니다. 새 링크를 만들어 주세요.</p>}
      {busy && <p role="status">초대를 처리하고 있습니다.</p>}
      {message && <p role="status">{message}</p>}
      {teamOnly && (
        <p className="notice">
          팀원 로그인은 계속 필요합니다. 방 코드를 아는 팀원의 입장까지 막으려면 입장을 잠가 주세요.
        </p>
      )}
    </section>
  );
}
