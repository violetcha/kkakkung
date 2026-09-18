// S15P21C204-278 (W4). 지금 이 칸에 장비를 놓을 수 있는지 화면이 미리 알려 준다.
// 서버 판정(EQ-01, planInstall)을 흉내 내지 않는다. 내 화면이 이미 아는 것만 보고,
// 확실히 막힌 경우에만 막혔다고 말한다. 통과로 보이더라도 최종 판정은 서버가 한다.
import type { EquipmentKind, PrivateView } from '@kkakkung/protocol/game-schema';

/** 방향별 앞칸 벡터. 원본은 game-core 의 DIR_VECTORS 다. */
const AHEAD = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
] as const;

export type InstallBlock =
  'moving' | 'installing' | 'restrained' | 'empty' | 'no-wall' | 'occupied';

const BLOCK_TEXT: Readonly<Record<InstallBlock, string>> = {
  moving: '멈춘 뒤에 설치할 수 있어요.',
  installing: '설치 중입니다. 다시 누르면 취소해요.',
  restrained: '구속이 풀리면 설치할 수 있어요.',
  empty: '남은 개수가 없어요. 다른 장비를 골라 보세요.',
  'no-wall': '벽을 마주 보고 서면 감지기를 붙일 수 있어요.',
  occupied: '이 칸에는 이미 장비가 있어요.',
};

export type InstallHint = Readonly<{
  kind: EquipmentKind;
  /** 내 화면이 아는 조건이 모두 맞는지. 서버가 다시 판정한다. */
  ready: boolean;
  /** 막힌 이유. 통과로 보이면 null 이다. */
  block: InstallBlock | null;
  /** 화면에 그대로 쓸 한 줄. 통과면 무엇을 누르면 되는지 알려 준다. */
  text: string;
}>;

const KIND_LABEL: Record<EquipmentKind, string> = { sensor: '감지기', trap: '덫' };
const KIND_GLYPH: Record<EquipmentKind, string> = { sensor: '▣', trap: '▲' };

/** 술래가 아니거나 경기 중이 아니면 힌트를 만들지 않는다. */
export function installHint(
  view: PrivateView | null,
  kind: EquipmentKind,
  tick: number,
): InstallHint | null {
  const self = view?.self;
  if (!view || self?.status !== 'ACTIVE' || self.role !== 'tagger') return null;
  const hint = (block: InstallBlock | null): InstallHint =>
    Object.freeze({
      kind,
      ready: block === null,
      block,
      text: block
        ? BLOCK_TEXT[block]
        : `${KIND_GLYPH[kind]} ${KIND_LABEL[kind]}를 여기에 설치할 수 있어요 · F`,
    });
  if (self.installation !== null) return hint('installing');
  if (self.restraintUntilTick !== null && tick < self.restraintUntilTick) return hint('restrained');
  if (self.action !== null) return hint('moving');
  if (self.equipment[kind] <= 0) return hint('empty');
  const ahead = AHEAD[self.dir] ?? AHEAD[0];
  const front = { x: self.cell.x + ahead.dx, y: self.cell.y + ahead.dy };
  if (
    kind === 'sensor' &&
    !view.visibleWallFaces.some(
      (face) => face.x === front.x && face.y === front.y && face.side === (self.dir + 2) % 4,
    )
  )
    return hint('no-wall');
  const here = (cell: Readonly<{ x: number; y: number }>) =>
    cell.x === self.cell.x && cell.y === self.cell.y;
  if (self.ownedEquipment.some((owned) => here(owned.cell))) return hint('occupied');
  if (
    view.visibleEntities.some(
      (entity) => (entity.kind === 'sensor' || entity.kind === 'trap') && here(entity.cell),
    )
  )
    return hint('occupied');
  return hint(null);
}

/** 십자선이 쓰는 값. 술래가 아니면 표시를 바꾸지 않는다. */
export function crosshairState(hint: InstallHint | null): 'ready' | 'blocked' | 'none' {
  if (!hint) return 'none';
  return hint.ready ? 'ready' : 'blocked';
}

/**
 * 첫 설치 안내(261 체계). 한 경기에 한 번만, 아직 아무것도 설치하지 않은 술래가 실제로 놓을 수
 * 있게 된 순간에만 낸다. 새 판정을 만들지 않고 installHint 가 이미 본 것을 글줄로 바꾼다.
 */
export function firstInstallPrompt(
  view: PrivateView | null,
  selected: EquipmentKind,
  tick: number,
): string | null {
  const self = view?.self;
  if (self?.status !== 'ACTIVE' || self.role !== 'tagger') return null;
  if (self.ownedEquipment.length > 0 || self.installation !== null) return null;
  return installHint(view, selected, tick)?.ready
    ? '지금 F를 누르면 장비를 설치합니다. 1·2로 감지기와 덫을 고릅니다.'
    : null;
}
