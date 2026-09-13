import { useEffect } from 'react';
import type { ChallengeView } from '@kkakkung/protocol/game-schema';
import { challengeKeys, DIRECTIONS, type ChallengeKey } from './key-challenge';
const LABELS = { up: '위 ↑', right: '오른쪽 →', down: '아래 ↓', left: '왼쪽 ←' } as const;
export function KeyChallenge({
  challenge,
  index,
  tick,
  onKey,
  onCancel,
  local = false,
}: {
  challenge: ChallengeView;
  index: number;
  tick: number;
  onKey(key: ChallengeKey, repeat?: boolean): void;
  onCancel(): void;
  local?: boolean;
}) {
  const expired = tick >= challenge.expiresAtTick;
  useEffect(() => {
    if (expired) return;
    const handler = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.target instanceof HTMLElement &&
          (event.target.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)))
      )
        return;
      const key = { ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left' }[
        event.key
      ] as ChallengeKey | undefined;
      if (key) {
        event.preventDefault();
        onKey(key, event.repeat);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [challenge.challengeId, expired, onKey]);
  return (
    <section className="game-panel" aria-label="키 대체 도전">
      <h2>방향키로 탈출 도전</h2>
      <p>카메라 입력 대신 아래 순서대로 키나 버튼을 누르세요. 틀리면 처음부터 시작합니다.</p>
      <ol className="key-sequence" aria-label="도전 순서">
        {challengeKeys(challenge.challengeId).map((key, step) => (
          <li key={key} aria-current={step === index ? 'step' : undefined}>
            {step < index ? '✓ ' : ''}
            {LABELS[key]}
          </li>
        ))}
      </ol>
      <div className="actions">
        {DIRECTIONS.map((key) => (
          <button key={key} disabled={expired || index >= 4} onClick={() => onKey(key)}>
            {LABELS[key]}
          </button>
        ))}
      </div>
      <p>
        {expired
          ? local
            ? '도전 시간이 끝났습니다. 다시 시작하세요.'
            : '서버의 도전 종료를 확인하고 있습니다.'
          : index >= 4
            ? local
              ? '입력 완료 · 잠시 자세를 유지하세요.'
              : '입력 완료 · 서버 시간과 결과를 확인하고 있습니다.'
            : `${Math.max(0, Math.ceil((challenge.expiresAtTick - tick) / 20))}초 남음`}
      </p>
      <button className="quiet" onClick={onCancel}>
        도전 취소
      </button>
    </section>
  );
}
