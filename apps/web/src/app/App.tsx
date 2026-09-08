import { useEffect, useMemo, useState } from 'react';
import type { Room } from '@colyseus/sdk';
import type { GameState } from '@kkakkung/protocol/game-schema';
import type { SandboxState } from '@kkakkung/protocol/schema';
import { WorldCanvas } from '../features/game/scene/WorldCanvas';
import { createMovementController } from '../features/input/movement-controller';
import { createTeamController } from '../features/input/team-controller';
import { createDevSession, joinSandbox, joinTeamRoom } from '../features/room/colyseus-session';
import { collectPlayerViews } from '../features/room/snapshot';
import { useAppStore } from '../features/room/store';
import { collectTeamPlayers } from '../features/room/team-snapshot';
import { createSessionRuntime, type RoomLifetime } from './SessionRuntime';
import '../styles.css';

type Mode = 'team' | 'sandbox';
type Store = ReturnType<typeof useAppStore.getState>;
let activeTeamRoom: Room<unknown, GameState> | undefined;

export default function App() {
  const [nickname, setNickname] = useState('');
  const [mode, setMode] = useState<Mode>('team');
  const store = useAppStore();
  const runtime = useMemo(
    () =>
      createSessionRuntime({
        createDevSession,
        joinRoom: async (token) =>
          mode === 'team'
            ? bindTeam(await joinTeamRoom(token), store)
            : bindSandbox(await joinSandbox(token), store),
        onSnapshot: ({ status, error }) => store.setConnection(status, error),
      }),
    [
      mode,
      store.resetWorld,
      store.setConnection,
      store.setFeedback,
      store.setTeamWorld,
      store.setWorld,
    ],
  );
  useEffect(
    () => () => {
      void runtime.disconnect();
    },
    [runtime],
  );
  const own = store.players.find((player) => player.playerId === store.sessionId);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = nickname.trim();
    if (!value || value.length > 20)
      return store.setConnection('error', '닉네임은 1~20자로 입력해 주세요.');
    void runtime.join(value);
  };
  const disconnect = async () => {
    await runtime.disconnect();
    store.resetWorld();
  };

  return (
    <main className="shell">
      <header>
        <div>
          <span className="eyebrow">PUBLIC DEVELOPMENT ROOM</span>
          <h1>연동 시험장</h1>
        </div>
        <span className="mvp">MVP 미완료</span>
      </header>
      <section className="hero" aria-label="접속 제어">
        <div>
          <p className="lead">
            {mode === 'team' ? '기존 룸 연동 / 규칙 구현 중' : '서버 권위 이동 진단용 샘플'}
          </p>
          <p className="notice">카메라·비전·음성 미디어는 아직 구현되지 않았습니다.</p>
        </div>
        {store.connection === 'connected' ? (
          <button type="button" className="danger" onClick={() => void disconnect()}>
            시험장 나가기
          </button>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="room-mode">연동 모드</label>
            <select
              id="room-mode"
              data-testid="room-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as Mode)}
              disabled={store.connection === 'joining'}
            >
              <option value="team">기존 룸 연동</option>
              <option value="sandbox">이동 샘플</option>
            </select>
            <label htmlFor="nickname">닉네임</label>
            <div className="join-row">
              <input
                id="nickname"
                value={nickname}
                maxLength={20}
                autoComplete="off"
                onChange={(event) => setNickname(event.target.value)}
                placeholder="1~20자"
                disabled={store.connection === 'joining'}
              />
              <button type="submit" disabled={store.connection === 'joining'}>
                {store.connection === 'joining' ? '연결 중…' : '입장'}
              </button>
            </div>
          </form>
        )}
      </section>
      {store.error && (
        <p className="error" role="alert">
          {store.error}
        </p>
      )}
      {store.feedback && (
        <p className="error" role="status">
          {store.feedback}
        </p>
      )}
      <section className="status-grid" aria-label="서버 상태">
        <article>
          <span>연결</span>
          <strong data-state={store.connection}>{connectionLabel(store.connection)}</strong>
        </article>
        <article>
          <span>{mode === 'team' ? '게임 상태' : '서버 Tick'}</span>
          <strong data-testid="team-phase" data-phase={store.phase}>
            {mode === 'team' ? phaseLabel(store.phase) : store.tick.toLocaleString()}
          </strong>
        </article>
        <article>
          <span>{mode === 'team' ? '남은 시간' : '참가자'}</span>
          <strong data-testid="time-left">
            {mode === 'team'
              ? `${Math.ceil((store.timeLeft ?? 0) / 1000)}초`
              : `${store.players.length} / 6`}
          </strong>
        </article>
      </section>
      <section className="stage">
        <div className="canvas-wrap">
          <WorldCanvas />
        </div>
        <aside>
          <h2>참가자</h2>
          {store.players.length === 0 ? (
            <p className="empty">아직 동기화된 참가자가 없습니다.</p>
          ) : (
            <ul>
              {store.players.map((player) => (
                <li key={player.playerId}>
                  <i className={player.playerId === store.sessionId ? 'self' : ''} />
                  <span>{player.nickname}</span>
                  {player.playerId === store.sessionId && <small>나</small>}
                </li>
              ))}
            </ul>
          )}
          {own && (
            <>
              <p className="position" data-testid="own-position">
                x {own.x.toFixed(2)} · z {own.z.toFixed(2)}
              </p>
              {mode === 'team' && (
                <p className="position" data-testid="own-role">
                  역할 {own.role === 'tagger' ? '술래' : '도망자'}
                </p>
              )}
            </>
          )}
          {mode === 'team' && store.connection === 'connected' && (
            <button
              type="button"
              data-testid="ready-button"
              className="ready"
              disabled={!own || store.phase !== 'waiting' || own.ready}
              onClick={() => activeTeamRoom?.send('ready', {})}
            >
              {own?.ready ? '준비 완료' : '준비하기'}
            </button>
          )}
          <div className="controls">
            <kbd>WASD</kbd>
            <span>{mode === 'team' ? 'W/S 이동 · A/D 회전' : '또는 방향키로 이동'}</span>
          </div>
        </aside>
      </section>
    </main>
  );
}

function bindTeam(room: Room<unknown, GameState>, store: Store): RoomLifetime {
  let active = false;
  const input = createTeamController({
    target: window,
    move: (command) => room.send('move', command),
    turn: (command) => room.send('turn', command),
  });
  const sync = (state: GameState) => {
    if (!active) return;
    const players = collectTeamPlayers(state);
    if (players)
      store.setTeamWorld(state.tick, state.timeLeft, state.phase, room.sessionId, players);
  };
  room.onStateChange(sync);
  room.onMessage<{ reason: string }>('rejected', ({ reason }) => {
    if (active) store.setFeedback(`명령이 거절되었습니다. (${reason})`);
  });
  room.onError((_code, message) => {
    if (active) store.setFeedback(message || '방 연결 오류가 발생했습니다.');
  });
  room.onLeave(() => {
    if (active) {
      active = false;
      activeTeamRoom = undefined;
      input.disconnect();
      store.resetWorld();
      store.setConnection('idle');
    }
  });
  return {
    activate() {
      active = true;
      activeTeamRoom = room;
      store.setFeedback(undefined);
      sync(room.state);
      input.connect();
    },
    async leave() {
      active = false;
      if (activeTeamRoom === room) activeTeamRoom = undefined;
      input.disconnect();
      await room.leave();
    },
  };
}

function bindSandbox(room: Room<unknown, SandboxState>, store: Store): RoomLifetime {
  let active = false;
  const input = createMovementController({
    target: window,
    send: (command) => room.send('move', command),
  });
  const sync = (state: SandboxState) => {
    if (!active) return;
    const players = collectPlayerViews(state);
    if (players) store.setWorld(state.tick, room.sessionId, players);
  };
  room.onStateChange(sync);
  room.onMessage<{ code: string }>('command-rejected', ({ code }) => {
    if (active) store.setFeedback(`이동 명령이 거절되었습니다. (${code})`);
  });
  room.onError((_code, message) => {
    if (active) store.setFeedback(message || '방 연결 오류가 발생했습니다.');
  });
  room.onLeave(() => {
    if (active) {
      active = false;
      input.disconnect();
      store.resetWorld();
      store.setConnection('idle');
    }
  });
  return {
    activate() {
      active = true;
      store.setFeedback(undefined);
      sync(room.state);
      input.connect();
    },
    async leave() {
      active = false;
      input.disconnect();
      await room.leave();
    },
  };
}

function connectionLabel(value: Store['connection']) {
  return ({ idle: '대기', joining: '연결 중', connected: '연결됨', error: '오류' } as const)[value];
}
function phaseLabel(value?: string) {
  return (
    (
      {
        waiting: '준비 대기',
        prep: '준비',
        countdown: '시작 직전',
        playing: '진행 중',
        result: '결과',
      } as Record<string, string>
    )[value ?? ''] ?? '동기화 중'
  );
}
