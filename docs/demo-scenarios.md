# 데모 시나리오

관리자 전용 데모 방에서 버튼 하나로 도는 대본 목록이다. 6명을 모으지 않고 게임 안의 기능이 실제로 동작하는지 확인하고, 평가자에게 "이건 이렇게 동작하고 이렇게 보인다"를 보여 주기 위한 도구다. **경기를 하기 위한 것이 아니다.**

원본은 `server/src/rooms/DemoScenarios.ts`의 `DEMO_SCENARIOS`이고, 이 문서의 표는 그와 같은 순서·같은 값이다. 웹은 `@kkakkung/protocol`의 `DEMO_SCENARIO_IDS`에서 같은 목록을 받는다.

## 1. 전제

- **판정은 전부 코어가 한다.** 대본은 인형에게 보통의 명령(이동·회전·설치·교환·탈출 보고)만 보낸다. 구속·포획·탈출·승패는 실제 경기와 똑같이 규칙이 낸다.
- **포획은 잡기 규칙을 따른다.** 술래 인형은 상대 옆 칸까지 가서 마주 보고 잡기를 낸다. 상대가 비키면 따라가 다시 잡는다. 칸을 밟는 것만으로는 포획이 아니다(S15P21C204-319).
- **인형은 대본 밖에서 한 칸도 움직이지 않는다.** 술래 인형이 돌아다니다 도망자 인형을 잡아 버리면 확인하려던 것을 못 보기 때문이다.
- **맵 크기는 준비 단계에서 고른다.** 데모 방은 인형이 곧바로 자리를 채워 로비를 지나치므로, 장치 점검 화면의 맵 크기(15×15·23×23·31×31 미로)로 고른다. 목록은 경기에 들어간 뒤 무대 옆 패널에 나온다.
- **교환 상대는 규칙이 받아 줄 인형으로 고른다.** 교환은 서로 모르는 곳이 있어야 성립하므로(KN-06) 한 번 나눈 인형과는 다시 요청할 수 없다. 대본이 아직 나눌 지식이 남은 인형을 고르고, 없으면 `NO_EXCHANGE_PARTNER` 로 시작하지 않는다.
- **길이 몸으로 막히면 옮긴다.** 통로 1칸 미로에서는 가만히 선 인형이 복도를 막아 걸어갈 길이 없을 수 있다. 그때 인형은 목적지로 곧바로 배치된다. 내 출구 앞 칸에 인형이 서 있으면 그 인형을 먼저 비킨다(S15P21C204-321).
- **제한시간이 없다.** 데모 경기는 `deadline: 'none'`으로 만들어져 시간 초과로 끝나지 않는다. 끝나는 길은 술래 승리·도망자 승리·무효뿐이다(S15P21C204-316).
- 관리자는 자리 하나를 쓰고 나머지 다섯은 서버가 조종하는 인형이다. 미디어는 발급하지 않는다.

## 2. 대본

`선택지`는 그 버튼이 실제로 읽는 설정이다. 표에 없는 키를 보내면 `UNSUPPORTED_OPTION`으로 거절한다 — 켜 두었는데 무시되는 설정을 만들지 않기 위해서다.

| 시나리오                 | 무엇을 확인하나                                                       | 선택지                            | 시작 못 하는 이유                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `place-me-at-exit`       | 내 출구 앞으로 걷지 않고 이동. 도전·자세·탈출·출구 닫힘을 바로 본다   | —                                 | `OPERATOR_MUST_BE_RUNNER` `NO_OPERATOR_STATE` `NO_OPERATOR_EXIT`                                                                                     |
| `place-puppet`           | 거리·방향별로 상대가 어떻게 보이는지. 안개·크기·실루엣·얼굴 평면      | `role` `side` `distance` `facing` | `NO_PUPPET` `CELL_UNAVAILABLE`                                                                                                                       |
| `approach`               | 상대가 다가올 때의 화면. 누가 다가올지와 어디서 멈출지를 고른다       | `role` `distance`                 | `NO_PUPPET`                                                                                                                                          |
| `cross-my-view`          | 시야 안팎 전환과 이동 보간                                            | `role`                            | `NO_PUPPET` `NO_CROSSING_PATH`                                                                                                                       |
| `turn-before-me`         | 네 방향을 한 바퀴. 실루엣과 얼굴 평면이 방향을 따라가는지             | `role` `distance`                 | `NO_PUPPET`                                                                                                                                          |
| `trap`                   | 덫 설치·무장·발동. `installer: 'me'`면 **내가 놓은 덫**이 도는지      | `installer`                       | `NO_TAGGER_PUPPET` `NO_ROOM_TO_INSTALL` `NO_ROOM_TO_RETREAT` `NO_RUNNER_PUPPET` / `installer: 'me'` 는 `OPERATOR_MUST_BE_TAGGER` `NO_OPERATOR_STATE` |
| `sensor`                 | 감지기 설치와 감지. 벽면에 붙는다                                     | `installer`                       | 위와 같고 `NO_ROOM_TO_INSTALL` 대신 `NO_WALL_TO_MOUNT`                                                                                               |
| `device-states`          | 설치 → 무장 전 → 무장 → 발동 → 소모를 단계마다 멈춰 서서 본다         | —                                 | `NO_TAGGER_PUPPET` `NO_RUNNER_PUPPET` `NO_ROOM_TO_INSTALL` `NO_ROOM_TO_RETREAT`                                                                      |
| `double-trap-immunity`   | 첫 덫에 구속되고 둘째 덫은 면역으로 지나간다                          | —                                 | `OPERATOR_MUST_BE_RUNNER` `NO_TAGGER_PUPPET` `NO_ROOM_FOR_TWO_TRAPS` `NO_ROOM_TO_RETREAT`                                                            |
| `capture`                | 술래가 나를 포획. 도망자 시점의 포획 화면                             | —                                 | `OPERATOR_MUST_BE_RUNNER` `NO_TAGGER_PUPPET`                                                                                                         |
| `capture-one`            | 인형끼리 포획. 공개 누계 ◆ 1/2 가 오르고 라운드는 이어진다            | —                                 | `NEED_ONE_PAIR`                                                                                                                                      |
| `capture-in-challenge`   | 도전이 열리면 그 옆에 나를 세운다. 잡기(G)로 잡으면 성립              | —                                 | `OPERATOR_MUST_BE_TAGGER` `NO_RUNNER_PUPPET` `NO_EXIT_FOR_PUPPET`                                                                                    |
| `caught-in-my-challenge` | 같은 규칙을 내 화면에서. 내가 도전을 시작하면 옆에 있던 술래가 잡는다 | —                                 | `OPERATOR_MUST_BE_RUNNER` `NO_OPERATOR_STATE` `NO_OPERATOR_EXIT` `NO_TAGGER_PUPPET`                                                                  |
| `exit`                   | 인형 도망자가 탈출. 누계가 오른다                                     | —                                 | `NO_RUNNER_PUPPET` `NO_EXIT_FOR_PUPPET`                                                                                                              |
| `exchange`               | 인형이 나에게 지도 교환을 요청. 받는 쪽 화면                          | —                                 | `OPERATOR_MUST_BE_RUNNER` `NO_RUNNER_PUPPET` `NO_EXCHANGE_PARTNER`                                                                                   |
| `exchange-cancel`        | 요청이 요청자 취소로 사라지는 것                                      | —                                 | 위와 같음 `NO_EXCHANGE_PARTNER`                                                                                                                      |
| `accept-my-exchange`     | **내가 요청하는 쪽.** 인형이 옆에서 기다렸다가 수락한다               | —                                 | `OPERATOR_MUST_BE_RUNNER` `NO_OPERATOR_STATE` `NO_RUNNER_PUPPET` `NO_EXCHANGE_PARTNER`                                                               |
| `exchange-trace`         | 교환 흔적을 술래 시점에서. 1초 뒤 2초간 보인다                        | —                                 | `OPERATOR_MUST_BE_TAGGER` `NEED_TWO_RUNNER_PUPPETS` `NO_EXCHANGE_PARTNER`                                                                            |
| `spectate-then-capture`  | 포획 → 관전 → 보던 대상이 잡혀 대상이 바뀜                            | —                                 | `OPERATOR_MUST_BE_RUNNER` `NEED_TWO_PAIRS` `NEED_TWO_RUNNER_PUPPETS`                                                                                 |
| `result-tagger-win`      | 결과 화면 · 술래 승리                                                 | —                                 | `NEED_TWO_PAIRS`                                                                                                                                     |
| `result-runner-win`      | 결과 화면 · 도망자 승리                                               | —                                 | `NEED_TWO_RUNNER_PUPPETS` `NO_EXIT_FOR_PUPPET`                                                                                                       |
| `abort-connection-lost`  | 참가자 연결 상실로 경기 무효                                          | —                                 | `NO_PUPPET`                                                                                                                                          |

`OPERATOR_NOT_ACTIVE`는 모든 대본에 공통이다. 목록(`scenarioOffers`)은 **모든 버튼을 보내되**, 기본 선택지로 지금 시작할 수 없으면 그 이유를 함께 보낸다. 웹은 그 버튼을 잠근 채 이유를 적는다. 그래서 `installer: 'me'` 만 되는 상황이면 `trap` 버튼은 기본값 기준의 이유와 함께 잠겨 보인다.

## 3. 관리자가 주도하는 대본

네 개는 인형이 먼저 움직이지 않고 **내가 먼저 하기를 기다린다.** 내가 만든 기능이 진짜 도는지 확인하려면 이쪽을 써야 한다.

| 대본                                | 내가 할 일                   | 인형이 기다리는 것           | 안 하면                      |
| ----------------------------------- | ---------------------------- | ---------------------------- | ---------------------------- |
| `trap`·`sensor` (`installer: 'me'`) | 장비를 놓고(F) 무장을 끝낸다 | 무장된 장비가 생기는 것      | `NO_INSTALL_FROM_OPERATOR`   |
| `accept-my-exchange`                | 옆에 온 인형에게 교환 요청   | 내 요청이 규칙을 통과하는 것 | `NO_REQUEST_FROM_OPERATOR`   |
| `caught-in-my-challenge`            | 출구 앞에서 도전을 시작      | 내 도전이 열리는 것          | `NO_CHALLENGE_FROM_OPERATOR` |

`installer: 'me'` 는 시작한다면 관리자를 장비를 놓을 수 있는 칸으로 먼저 옮긴다. 규칙이 시작 칸 설치를 막기 때문이다(EQ-01). 감지기는 벽을 봐야 붙으므로 벽 쪽으로 돌려세운다.

이 대본들은 방이 관리자 상태(내 장비·내 도전·내 교환·내 출구)를 채워 줘야 돈다. 채워지기 전에는 `NO_OPERATOR_STATE`로 거절해, 반쯤 도는 버튼을 보여 주지 않는다.

## 4. 중단

진행 중 실패는 `<단계>:<이유>`로 보고한다. `TIMEOUT`은 상한(2400 Tick)을 넘긴 것, `FAILED`는 규칙이나 방이 그 동작을 거절한 것, 나머지 셋은 3절의 "관리자가 안 한 일"이다. 어느 쪽이든 대본은 방을 막지 않고 끝나며, 다른 버튼을 바로 누를 수 있다. 관리자를 기다리는 대본은 패널의 **시나리오 취소**로 라운드를 끝내지 않고 내릴 수 있고, 그때는 `CANCELED` 로 끝난다.

## 5. 시험

| 시험                                                  | 범위                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `server/test/room/demo-runner.test.ts`                | 합성 세계 위에서 대본이 **무엇을 요구하는지**. 전제 거절·정상 완료·상한 초과 |
| `server/test/room/demo-scenarios.test.ts`             | 실제 방·코어·명령 큐. 실시간 대본은 옵트인 `KKAKKUNG_DEMO_SCENARIOS=1`       |
| `packages/game-core/test/match/demo-controls.test.ts` | 제한시간 없는 경기와 참가자 배치 제어 자체                                   |
