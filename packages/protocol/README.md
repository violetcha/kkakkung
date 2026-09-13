# @kkakkung/protocol

웹 클라이언트와 게임 서버가 함께 사용하는 최소 공개 계약입니다. 세부 게임 규칙이나 서버 전용 상태는 이 패키지에 두지 않습니다.

서브 경로별 역할은 다음과 같습니다. `messages/schema`의 sandbox 및 개발0.1 계약과 실제 제품0.2 계약을 혼용하지 않습니다.

- `@kkakkung/protocol/messages`: 입장, 개발 세션, 이동 명령, 명령 거절 이벤트의 strict Zod 스키마와 타입
- `@kkakkung/protocol/schema`: Colyseus 공개 동기화 상태인 `PlayerState`, `SandboxState`
- `@kkakkung/protocol/game-messages`: 제품0.2의 세션·명령/종결·개인 뷰·미디어/운영 공개 스키마
- `@kkakkung/protocol/game-schema`: 제품/기존 game 상태 Schema
- `@kkakkung/protocol/version`: `PROTOCOL_VERSION`, `ROOM_NAME`

모든 입력 스키마는 문서에 없는 키를 거절합니다. Schema 클래스는 Schema 5의 `schema()`와 `t.*` builder로 정의해 NodeNext ESM, Vite, TypeScript 6에서 별도 데코레이터 설정 없이 동일한 추적 accessor를 사용합니다. `PlayerState`와 `SandboxState`는 각각 값 위치에서 `new`로 생성할 수 있고 타입 위치에서도 그대로 사용할 수 있습니다.

```ts
import { moveCommandSchema } from '@kkakkung/protocol/messages';
import { SandboxState } from '@kkakkung/protocol/schema';
import { PROTOCOL_VERSION } from '@kkakkung/protocol/version';
```
