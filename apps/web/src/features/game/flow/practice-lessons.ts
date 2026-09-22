// S15P21C204-295. 팀 연습에서 "무엇을 해 봤는지"를 센다. 혼자 연습(튜토리얼)과 같은 목록을 쓰되,
// 여기서는 내 시야(PrivateView)의 변화만 본다: 서버가 적용한 결과만 확인으로 친다.
// 판정에는 쓰지 않는다. 화면 안내와 진행 표시에만 쓴다.
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { LESSONS, type Lesson } from '../solo/solo-world';

export { LESSONS, type Lesson };

/** 몸을 쓰는 다섯 가지는 역할과 상관없다. 마지막 하나만 역할에 따라 갈린다. */
export const COMMON_LESSONS: readonly Lesson[] = ['forward', 'back', 'left', 'right', 'neutral'];
export const ROLE_LESSON = { runner: 'runner', tagger: 'tagger' } as const;

/** dir 0,1,2,3 이 향하는 칸. 게임 코어와 같은 순서다. */
const STEPS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

export type LessonMark = Readonly<{
  cell: { x: number; y: number };
  dir: number;
  moved: boolean;
}>;

export type LessonState = Readonly<{
  completed: ReadonlySet<Lesson>;
  last: LessonMark | null;
}>;

export const EMPTY_LESSONS: LessonState = Object.freeze({
  completed: new Set<Lesson>(),
  last: null,
});

/**
 * 한 번 본 시야로 목록을 갱신한다. 바뀐 것이 없으면 같은 객체를 돌려주어 화면을 다시 그리지 않는다.
 * - 앞뒤: 바라보던 방향으로 한 칸 옮겼는지로 본다.
 * - 좌우: 방향이 한 칸 돌았는지로 본다.
 * - 중립: 한 번 움직여 본 뒤 동작이 멎은 순간이다.
 * - 역할: 도망자는 탈출 도전을 열었을 때, 술래는 장비를 놓아 봤을 때.
 */
export function observeLessons(state: LessonState, view: PrivateView | null | undefined) {
  const self = view?.self;
  if (!self || self.status !== 'ACTIVE') return state;
  const completed = new Set(state.completed);
  const before = completed.size;
  const last = state.last;
  const step = last ? STEPS[last.dir % 4] : null;
  if (last && step) {
    if (self.cell.x === last.cell.x + step[0] && self.cell.y === last.cell.y + step[1])
      completed.add('forward');
    if (self.cell.x === last.cell.x - step[0] && self.cell.y === last.cell.y - step[1])
      completed.add('back');
    if (self.dir === (last.dir + 3) % 4) completed.add('left');
    if (self.dir === (last.dir + 1) % 4) completed.add('right');
  }
  const moved = completed.has('forward') || completed.has('back');
  if (moved && self.action === null) completed.add('neutral');
  if (self.challenge !== null) completed.add('runner');
  if (self.installation !== null || self.ownedEquipment.length > 0) completed.add('tagger');
  const sameMark =
    last !== null &&
    last.cell.x === self.cell.x &&
    last.cell.y === self.cell.y &&
    last.dir === self.dir;
  if (completed.size === before && sameMark) return state;
  return {
    completed,
    last: { cell: { x: self.cell.x, y: self.cell.y }, dir: self.dir, moved },
  };
}

export const lessonList = (role: 'runner' | 'tagger'): readonly Lesson[] => [
  ...COMMON_LESSONS,
  ROLE_LESSON[role],
];
