# 프로토콜

공유 protocol 버전은 `0.1.0`이다. `/api/config`의 `roomName`은 React 기본값인 `kkakkung`, `diagnosticRoomName`은 선택형 이동 샘플 `sandbox`다. 기존 `kkakkung` 계약은 [server/docs/protocol.md](../server/docs/protocol.md)가 기준이고, 이 문서의 아래 계약은 `sandbox`에만 적용한다.

## 입장

`joinOptionsSchema`는 `{ token: string, protocolVersion: string }`만 허용한다. 서버는 일회성 개발 토큰을 소비하고 playerId를 발급한다. 클라이언트가 보낸 playerId나 알 수 없는 키는 받지 않는다.

## 이동

메시지 이름은 `move`다. payload는 `{ seq, x, z }`이며 `seq`는 0 이상의 안전한 정수, 축 값은 유한한 `-1..1`이다. 서버 adapter가 playerId를 붙이고, 유효하지 않은 명령은 `command-rejected`의 `{ code }`로 알린다.

한 Tick 입력은 해당 Tick에만 적용한다. 중복 또는 오래된 seq, 미등록 참가자, 잘못된 값은 권위 상태를 바꾸지 않는다.

## 공개 상태

`PlayerState`는 `playerId`, `nickname`, `x`, `z`를 가진다. `SandboxState`는 `protocolVersion`, `phase=sandbox`, `tick`, `players`를 가진다. 이 Schema는 연결 시험용 공개 상태다. 후속 개인 지도·시야·사건 계약은 서버 전체 상태를 복사하지 않고 별도 projection으로 설계한다.

계약을 변경할 때는 Zod 검증, Colyseus Schema, 웹·서버 소비자와 호환성 시험을 함께 변경한다.

`kkakkung`의 `move {seq, dir: "forward"|"back"}`, `turn`, `ready`, 셀 `x/y`와 `sandbox`의 `{seq,x,z}`를 같은 메시지로 간주하지 않는다. 두 Room은 현재 단일 전역 용량을 공유해 동시에 사용할 수 없다.
