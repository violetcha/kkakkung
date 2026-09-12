# @kkakkung/game-core

서버가 사용하는 순수 TypeScript 게임 규칙 패키지입니다. IO, SDK, 현재 시간, 외부 난수를 직접 읽지 않으며 `@kkakkung/protocol`에도 의존하지 않습니다.

제품 `kkakkung` 0.2의 엔진은 `src/match`에 있으며 맵·이동·회전·시야·지도 지식과 교환·장비·구속·포획·출구 도전·승패를 계산합니다. 서버가 Tick·명령·설정과 시드를 전달합니다. 현재 제품 범위와 결정 대기는 [최신 기획서](../../docs/spec/current.md)를 따릅니다. 코드의 존재와 실제 Cloud·장치 검증 결과는 별개입니다.

아래는 별도로 유지하는 초기 진단용 월드 API입니다. 이 API의 Tick 간격은 호출자가 초 단위로 주입합니다.

```ts
import { addPlayer, createWorld, stepWorld } from '@kkakkung/game-core';

let world = createWorld({ halfExtent: 8, speed: 4 });
world = addPlayer(world, { id: 'player-1', nickname: '까꿍' });
world = stepWorld(world, [{ playerId: 'player-1', seq: 0, x: 1, z: 1 }], 0.05);
```

각 함수는 기존 상태를 바꾸지 않고 새 상태를 반환합니다. 한 Tick에는 참가자별 최신 유효 명령 하나만 적용합니다. 입력이 없는 다음 Tick에는 이동하지 않습니다. 이동 벡터는 길이 1로 제한하고 좌표는 정사각형 맵 경계 안에 고정합니다. 미등록 참가자의 명령과 이미 처리한 `seq` 이하의 명령은 상태에 반영하지 않습니다. 유한하지 않은 수, 범위를 벗어난 축, 잘못된 `seq`, 잘못된 등록 정보 같은 직접 도메인 입력은 공개 함수 경계에서 예외로 거절합니다.

이 진단용 월드 API에는 시야, 포획, 비밀 맵, 적 상태가 포함되지 않습니다. 제품 `src/match` 엔진의 범위를 설명하는 제한은 아닙니다.

`halfExtent`와 `speed`는 공개 상태의 필드가 아니라 내부 `WeakMap`에 상태별 설정으로 연결됩니다. 상태는 `createWorld`와 이 패키지의 함수가 반환한 값을 사용해야 하며, 임의로 복제하거나 JSON에서 복원한 상태는 설정 연결이 없어 거절됩니다.
