# 까꿍 게임 서버

Node.js + Colyseus 서버 권위형 매치 서버. 규칙 문서는 [docs/protocol.md](docs/protocol.md).

## 실행

```bash
cd server
npm install
npm start
```

- 게임 서버: `ws://localhost:2567`
- 테스트 화면: http://localhost:2567/playground — 방 접속 · 메시지 전송 · 상태 확인
- 관리 화면: http://localhost:2567/monitor

playground 탭을 두 개 열어 각각 `kkakkung` 룸에 접속 → 둘 다 `ready` 전송 → 한쪽에서 `move {"seq":1,"dir":"forward"}` 를 보내면 다른 탭의 상태에서 좌표가 바뀐다.

## 구조

```
src/
├─ domain/      규칙 계산 (손주연). Colyseus 를 import 하지 않는다. 지금은 스텁
├─ rooms/       Room · Schema · StateView (정유림). domain 을 호출만 한다
│  ├─ KkakkungRoom.ts
│  └─ schema/GameState.ts
├─ integrations/  LiveKit 등 외부 연동 (3단계)
└─ index.ts     서버 기동
```

## 현재 단계: 0단계 뼈대

- [x] 6인 방, 입장 시 Player 생성, 고정 맵
- [x] move / turn / ready → domain 판정 → 상태 변경
- [x] 상태 머신 골격 waiting → playing → result
- [x] StateView 골격: 술래 패킷에 `exits` 없음
- [ ] [E2] 방 코드 참가 · 6인 강제
- [ ] [E2] 서버 역할 배정 (현재는 입장 순서 임시)
- [ ] [E2] StateView 시야 필터링 (1단계)
