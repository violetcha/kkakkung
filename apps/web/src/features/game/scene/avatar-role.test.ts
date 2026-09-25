// S15P21C204-378. 서버는 적에게 역할 표시를 붙이지 않는다. 몸은 보는 사람 역할의 반대로 고른다.
import { expect, it } from 'vitest';
import { withAvatarRole } from './FaceAvatar';

const enemy = {
  id: 'alias-1',
  kind: 'player' as const,
  cell: { x: 1, y: 2 },
  dir: 0 as const,
  action: null,
};

it('draws an unlabeled player as the other team', () => {
  expect(withAvatarRole(enemy, 'runner').role).toBe('tagger');
  expect(withAvatarRole(enemy, 'tagger').role).toBe('runner');
});

it('keeps a role the server sent and leaves players alone when the viewer has no role', () => {
  const ally = { ...enemy, id: 'p2', role: 'runner' as const };
  expect(withAvatarRole(ally, 'runner')).toBe(ally);
  expect(withAvatarRole(enemy, undefined)).toBe(enemy);
});
