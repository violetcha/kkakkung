import type { PrivateView, VisibleEntity } from '@kkakkung/protocol/game-schema';

type VisiblePlayer = Extract<VisibleEntity, { kind: 'player' }>;

/**
 * 서버가 보낸 **현재 시야**를 그대로 넘긴다. 시점 주인이 누구인지만 고르고 셀·벽면은 자르지
 * 않는다(S15P21C204-301).
 *
 * 예전에는 여기서 거리로 한 번 더 걸렀다. 그 필터는 아무것도 보태지 못하면서 잘라내기만
 * 했다. 서버는 범위 밖 셀을 애초에 보내지 않고(코어 `withinCone`), 그 판정은 카메라에서 셀의
 * **샘플점**까지 재는데 여기서는 정수 좌표끼리 쟀기 때문이다. 그래서 서버가 보인다고 한
 * 대각선 셀과 정면 끝 벽면이 화면에서 빠졌고, 이동 중에는 서버 카메라만 보간되어 가장자리가
 * 깜빡였다. 같은 라운드에서 미니맵과 3D 화면의 판정도 갈렸다.
 *
 * 과거 지식이 현재 시야로 새지 않는 것은 이 함수가 아니라 프로토콜이 보장한다. 누적 지도는
 * `knownTerrain`·`knownActiveExits` 라는 별도 필드이고 이 함수는 그것을 읽지 않는다.
 *
 * 남는 판단은 하나다. **시점 주인 본인은 그리지 않는다.** 1인칭이라 자기 아바타가 화면을
 * 가리고, 관전 중에는 보고 있는 대상이 그 자리에 있다.
 */
export function visibilityMask(view: PrivateView) {
  const perspective =
    view.self?.status === 'ACTIVE'
      ? view.self.playerId
      : view.spectating
        ? view.spectating.targetId
        : null;
  if (perspective === null) return { cells: [], walls: [], players: [] };
  return {
    cells: view.visibleCells,
    walls: view.visibleWallFaces,
    players: view.visibleEntities.filter(
      (entity): entity is VisiblePlayer => entity.kind === 'player' && entity.id !== perspective,
    ),
  };
}
