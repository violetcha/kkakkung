import { describe, expect, it } from 'vitest';
import { mediaBindingSchema } from '@kkakkung/protocol/game-messages';
import { createEnemyAliases, ENEMY_ALIAS_PREFIX } from '../../src/game/EnemyAliases.js';

// S15P21C204-340. 적 playerId 는 라운드 동안 안정된 불투명 별칭으로만 나간다.
describe('enemy aliases', () => {
  it('mints one stable alias per player and forgets them all on clear', () => {
    let n = 0;
    const aliases = createEnemyAliases(() => `m${++n}`);
    expect(aliases.aliasOf('t1')).toBe(`${ENEMY_ALIAS_PREFIX}m1`);
    expect(aliases.aliasOf('t1')).toBe(`${ENEMY_ALIAS_PREFIX}m1`);
    expect(aliases.aliasOf('t2')).toBe(`${ENEMY_ALIAS_PREFIX}m2`);
    aliases.clear();
    expect(aliases.aliasOf('t1')).toBe(`${ENEMY_ALIAS_PREFIX}m3`);
  });

  it('shows the real id to the player itself and its allies, the alias to enemies', () => {
    const aliases = createEnemyAliases(() => 'x');
    expect(aliases.visibleId('r1', 'runner', 'r1', 'runner')).toBe('r1');
    expect(aliases.visibleId('r2', 'runner', 'r1', 'runner')).toBe('r2');
    expect(aliases.visibleId('t1', 'tagger', 'r1', 'runner')).toBe(`${ENEMY_ALIAS_PREFIX}x`);
    expect(aliases.visibleId('r1', 'runner', 't1', 'tagger')).toBe(`${ENEMY_ALIAS_PREFIX}x`);
    // 역할을 모르면 비교할 것이 없으므로 기존 동작(실제 id)을 유지한다.
    expect(aliases.visibleId('t1', null, 'r1', 'runner')).toBe('t1');
    expect(aliases.visibleId('t1', 'tagger', 'r1', undefined)).toBe('t1');
  });

  it('produces ids that fit the wire schema and cannot be mistaken for a real player id', () => {
    const aliases = createEnemyAliases();
    const alias = aliases.aliasOf('some-player');
    expect(alias.startsWith(ENEMY_ALIAS_PREFIX)).toBe(true);
    expect(alias).not.toContain('some-player');
    expect(alias.length).toBeGreaterThan(ENEMY_ALIAS_PREFIX.length);
    expect(
      mediaBindingSchema.safeParse({
        playerId: alias,
        publisherGeneration: 1,
        mediaIdentity: 'ns--1--abc',
        participantSid: 'PA_1',
      }).success,
    ).toBe(true);
    // 두 플레이어가 같은 별칭을 받지 않는다.
    expect(aliases.aliasOf('other-player')).not.toBe(alias);
  });
});
