// S15P21C204-295. 팀 연습 화면의 할 일 목록. 혼자 연습(튜토리얼)과 같은 목록·같은 모양이다.
// 경기 전에 몸으로 한 번씩 해 보고 준비를 신고한다. 시간이 지나도 준비를 대신 눌러 주지 않는다.
import type { Role } from '@kkakkung/protocol/game-schema';
import type { RequestDisplay } from '../../room/command-lifecycle';
import { LESSONS, lessonList, type Lesson } from './practice-lessons';

const QUEST_KEYS: Record<Lesson, string> = {
  forward: 'W',
  back: 'S',
  neutral: '키 놓기',
  left: 'A',
  right: 'D',
  tagger: 'F',
  runner: 'E',
};

export function PracticeQuests({
  role,
  completed,
  canReady,
  request,
  readyReported,
  onReady,
}: {
  role: Role;
  completed: ReadonlySet<Lesson>;
  canReady: boolean;
  request?: RequestDisplay;
  readyReported: boolean;
  onReady(): void;
}) {
  const quests = lessonList(role);
  const done = quests.filter((id) => completed.has(id)).length;
  const next = quests.find((id) => !completed.has(id)) ?? null;
  const submitted = readyReported && request?.status === 'applied';
  const pending = request?.status === 'pending' || request?.status === 'waiting-view';
  return (
    <section className="solo-quests practice-quests" aria-label="연습 진행">
      <header>
        <span className="solo-quests-kicker">
          {role === 'runner' ? '도망자 연습' : '술래 연습'}
        </span>
        <span className="solo-quests-count">
          {done} / {quests.length}
        </span>
      </header>
      <ol>
        {quests.map((id) => {
          const isDone = completed.has(id);
          return (
            <li key={id} data-completed={isDone} data-current={!isDone && id === next}>
              <span className="solo-quest-mark">{isDone ? '✓' : ''}</span>
              <span className="solo-quest-label">{LESSONS[id]}</span>
              <kbd>{QUEST_KEYS[id]}</kbd>
            </li>
          );
        })}
      </ol>
      <button disabled={!canReady || pending || submitted} onClick={onReady}>
        {submitted ? '준비 확인 · 전환 대기' : pending ? '준비 신고 중…' : '연습 준비 완료'}
      </button>
      <p className="solo-quests-done">
        {!canReady
          ? '장치 준비가 필요해요. 시간이 지나도 준비를 대신 누르지 않습니다.'
          : next === null
            ? '다 해 봤어요. 전원이 준비하거나 60초가 지나면 경기로 넘어갑니다.'
            : '전원 준비 또는 최대 60초 뒤에 다음 단계로 넘어갑니다.'}
      </p>
    </section>
  );
}
