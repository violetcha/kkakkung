# D · 장치·비전·입력·브라우저 미디어 실행 문서

작성 기준: 2026-09-08 · 스켈레톤 `d6f8e62` · **EXEC-CONTRACT-2**  
담당 범위: 단일 장치 소유권, MediaPipe Worker, 입력 판별과 얼굴/음성 송수신  
원본 작업: **17개** · 리뷰 상대: **C** · 현재 상태: **모두 구현 계획**

이 문서와 [기획서 v0.0.8](../spec/README.md)을 실행 입력으로 사용한다. AI는 기존 코드와 저장소 지침을 직접 읽는다. 팀원에게 다른 담당 문서의 내용을 찾아 오도록 요구하지 않는다. [6인 전체 일정](README.md)은 인계 시점을 확인하는 안내다.

목표는 **9월 8일(화)·9일(수) 핵심 구현, 10일(목) 통합·검증·수정, 11일(금) 오전 MVP 인수**다. 작업 개수는 소요시간이나 완료 보증이 아니다. 선행 작업·실제 Cloud·장치가 준비되지 않은 조건은 완료로 계산하지 않는다.

## 날짜별 오늘 작업표

각 날짜에서 오늘 번호를 1부터 다시 센다. 예를 들어 9월 9일에 “오늘 1번부터 5번”을 요청하면 **D2 표의 1–5번**을 수행한다. `D-01` 같은 고정 번호와 원본 ID는 날짜가 지나도 바꾸지 않는다. 일정 이후에는 날짜 또는 고정 번호를 명시한다.

### D1 · 2026-09-08 화요일

계약·환경과 병렬 구현 기반을 만들고 권위 이동·장치 점검을 연결. 새 원본 작업 12개.

| 오늘 번호 | 고정 번호                      | 원본 ID | 완료할 결과                         |
| --------- | ------------------------------ | ------- | ----------------------------------- |
| 1         | [D-01](d-vision-media.md#d-01) | IN-01   | 카메라·마이크 분리 취득과 장치 수명 |
| 2         | [D-02](d-vision-media.md#d-02) | IN-02   | 최신 프레임 한 개의 Worker 전송     |
| 3         | [D-03](d-vision-media.md#d-03) | IN-03   | 얼굴 센서값 추론                    |
| 4         | [D-04](d-vision-media.md#d-04) | IN-04   | 상체·탈출 자세 추론                 |
| 5         | [D-05](d-vision-media.md#d-05) | IN-05   | 손바닥·브이 제스처 추론             |
| 6         | [D-06](d-vision-media.md#d-06) | IN-06   | 중립 보정과 센서 안정화             |
| 7         | [D-07](d-vision-media.md#d-07) | ME-01   | 흑백 얼굴 마스크·가공 스트림 생성   |
| 8         | [D-08](d-vision-media.md#d-08) | ME-02   | 얼굴 추적 실패의 안전 프레임 전환   |
| 9         | [D-09](d-vision-media.md#d-09) | IN-07   | 전후진 모션·키보드 의도 통합        |
| 10        | [D-10](d-vision-media.md#d-10) | IN-08   | 회전 모션·키 해제 발동              |
| 11        | [D-11](d-vision-media.md#d-11) | IN-09   | 손동작·단축키의 행동 문맥 중재      |
| 12        | [D-12](d-vision-media.md#d-12) | IN-10   | 카메라·추론 장애의 입력 폴백        |

### D2 · 2026-09-09 수요일

MVP 핵심 기능을 구현하고 생산자·소비자를 통합. 새 원본 작업 5개.

| 오늘 번호 | 고정 번호                      | 원본 ID | 완료할 결과                       |
| --------- | ------------------------------ | ------- | --------------------------------- |
| 1         | [D-13](d-vision-media.md#d-13) | ME-03   | 승인된 미디어 세대 연결           |
| 2         | [D-14](d-vision-media.md#d-14) | ME-04   | 가공 얼굴·선택 마이크 게시        |
| 3         | [D-15](d-vision-media.md#d-15) | ME-05   | 허용 얼굴 트랙 수신·교체          |
| 4         | [D-16](d-vision-media.md#d-16) | ME-06   | 근거리 오디오 그래프·효과음 재생  |
| 5         | [D-17](d-vision-media.md#d-17) | ME-07   | 미디어 세대 종료와 참가 종료 분리 |

### D3 · 2026-09-10 목요일

최종 흐름·실기기·Cloud·부하 검증과 결함 수정. 새 원본 작업 없이 기존 작업의 통합과 결함을 마무리한다.

| 오늘 번호 | 고정 번호        | 원본 ID      | 완료할 결과                                                                                            |
| --------- | ---------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| 1         | 기존 D 작업 후속 | 신규 ID 없음 | C-18·C-19와 함께 로딩 준비·개인 종료·재경기의 devices/track/VideoTexture 인계 순서를 확인한다.         |
| 2         | 기존 D 작업 후속 | 신규 ID 없음 | 실제 대표 장치에서 face+pose+gesture와 키 폴백을 동시에 시험하고 성능 preset을 측정값에 맞춰 적용한다. |
| 3         | 기존 D 작업 후속 | 신규 ID 없음 | 6대 5판에서 모션 미검출·오입력·잔류 음성·옛 트랙 문제를 자기 facade 내부에서 수정한다.                 |
| 4         | 기존 D 작업 후속 | 신규 ID 없음 | G1/G5/G6의 실제 트랙·음성 증거를 F runner와 연결하고 구독 정책을 클라이언트 mute로 우회하지 않는다.    |
| 5         | 기존 D 작업 후속 | 신규 ID 없음 | 원본 카메라/마이크·Worker·AudioContext·세대별 트랙 정리 결과와 남은 장치 한계를 F에 인계한다.          |

D3 결함 수정은 원본 122개 작업의 후속 처리다. 별도 스토리 수를 늘리지 않는다. 수정한 파일 소유자가 검증 후 `fix:` 커밋과 MR 본문을 남긴다. C/F의 신규 D3 항목이 있더라도 같은 날 발견한 자기 소유 결함은 함께 마무리한다.

<!-- BEGIN EXEC-CONTRACT-2 COMMON -->

# 공통 실행 계약 원본

버전: **EXEC-CONTRACT-2** · 적용 결정: **D-2026-09-08-01** · 갱신일: 2026-09-08

이 파일은 여섯 담당 문서에 자동 삽입하는 유일한 공통 원본이다. 기존 EXEC-CONTRACT-1의 미정 아이템과 불완전한 연결 계약을 대체한다. 기획서 원본을 새 승인 내용으로 소급 수정하지 않는다. [최신 결정 정정표](../spec/decisions.md)가 v0.0.8과 충돌하는 부분에 우선한다.

## 이 문서로 실행하는 방법

담당자가 작업 번호의 실행을 요청하면 구현·검증·작업별 로컬 커밋·MR 본문 작성까지 수행한다. 푸시·GitLab MR 생성·원격 병합은 담당자가 직접 한다. 문서를 검토하거나 읽는 요청만으로 제품 구현을 시작하지 않는다.

```text
내 담당 실행 문서와 docs/spec/decisions.md, v0.0.8 기획서를 기준으로
오늘 작업표 1번부터 5번까지 진행해줘.
결정 대기 작업은 구현하지 말고 해당 번호를 보류한 뒤 다음 번호를 진행해줘.
검증된 중간 산출물과 완료 작업은 내 Git 신원으로 각각 로컬 커밋해줘.
작업별 MR 본문과 이번 실행분 합본을 작성하고 전체 본문을 보여줘.
푸시·MR 생성·원격 병합은 하지 마.
```

- 오늘 번호는 날짜별 표에서 찾고 고정 번호·원본 ID는 유지한다. 같은 작업 재요청 시 코드·Git 로그·진행 기록으로 중복 커밋을 방지한다.
- 코드·지침·설치된 SDK 타입·계약 파일은 AI가 직접 읽는다. 사람에게 함수명·파일 위치를 찾아 전달하도록 요구하지 않는다.
- **MP-06, EQ-06, EQ-07, EQ-08, EQ-09, EQ-12는 PRODUCT_DECISION_PENDING**이다. 종류·효과·수량·획득·소지·사용이 정해지기 전 구현·가짜 완료·대체 아이템 설계를 하지 않는다.
- EQ-11은 구속 상태 HUD만 진행한다. 술래 감지기·덫, 자연 구속 만료·유예, 회전·포획, 공통 후보 우선순위는 유지한다.
- 제품 계약에 아이템 종류·인벤토리·아이템 사용 명령·아이템 엔티티를 추가하지 않는다. 결정 대기 상태는 완료나 승인된 범위 제외로 바꾸지 않는다.
- 목표는 9/8–9 핵심 구현, 9/10 통합·검증·수정, 9/11 금요일 오전 인수다. 확정 범위의 G1–G6 증거와 미정 아이템의 상태를 함께 보고한다. 기존 v0.0.8 전체 요구가 완료됐다고 선언하지 않는다.

## 설치와 공통 검사

Node.js 24.19.0 / pnpm 11.19.0 / TypeScript 6.0.3과 루트 lockfile을 유지한다.

```bash
pnpm install --frozen-lockfile
pnpm setup:env
pnpm exec playwright install chromium
pnpm build:packages
node scripts/check-execution-plan.mjs
```

공통 계약·fixture의 타입 검사는 계획 정합성 검사다. 실제 모듈 통합·Cloud·장치·부하 검증이 아니다. 새 시험/runner는 해당 작업에서 만들 산출물이며 파일이 없다고 skip 또는 성공으로 처리하지 않는다. 작업별 검증 후 타입·lint·빌드를 확인하고 일차 인계 전에는 `pnpm verify`를 실행한다. 기본 verify는 실제 Cloud나 장시간 부하를 자동 실행하지 않는다.

## 단독 수정 영역과 공통 계약 변경

| 담당 | 단독 수정 영역                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | game-core의 match 소스/시험, server/content, server/config/tuning, 기존 server/src/domain/index.ts·types.ts 재노출                                                              |
| B    | protocol의 src/test, server/src/rooms·game·session, bootstrap.ts/index.ts/main.ts, 서버 room/protocol/session 시험과 기존 server/tests/integration·tick.test.ts·session.test.ts |
| C    | 웹 app, features/room·game, styles.css, 화면/장면 시험, 3D 자산                                                                                                                 |
| D    | 웹 features/devices·vision·input·media와 해당 시험, public/models, tsconfig.worker.json                                                                                         |
| E    | server/src/media·operations·health와 해당 server/test                                                                                                                           |
| F    | manifest/lockfile·공통 설정·env.ts, infra/Jenkins/scripts/tests, server/src/observability, 검증·배포 문서                                                                       |

B만 서버 최종 조립을, C만 웹 최종 조립을, F만 공통 설정과 의존성을 수정한다. A는 protocol을 import하지 않고 B가 변환한다. 웹은 서버 실제 맵·game-core·운영 내부값을 import하지 않는다. 제품은 0.2.0의 kkakkung, sandbox 0.1.0은 개발 진단용으로 격리한다. 기존 공개 maze·빈 입장·Playground와 개발 adapter는 production 라우트에서 차단한다. 개발 회귀용 경로만 유지하며 제품 기능을 위해 진단 API를 확장하지 않는다.

공통 의미 변경은 B가 총괄하여 `docs/execution/common.md`와 `contracts/types.ts`·fixture를 수정한다. D 센서·E 미디어처럼 실제 생산자/소비자가 검토한다. F는 동기화 검사기를 소유한다. A–F 문서의 공통 블록은 직접 편집하지 않고 아래 명령으로 갱신한다.

```bash
node scripts/check-execution-plan.mjs --sync
node scripts/check-execution-plan.mjs
```

일반 리뷰 쌍은 A↔B, C↔D, E↔F다. 공개 경계 변경에는 해당 소비자를 추가한다: B 명령/개인 뷰는 C·D, E 세대/바인딩은 B·D, D callback은 C, F Worker/CSP/모델은 D, readiness는 B·E. 모든 사람이 모든 변경을 리뷰할 필요는 없다.

## 좌표·시간·라운드 수명

- Cell은 정수 x/y=0–31, Dir은 0북(y−1)/1동(x+1)/2남(y+1)/3서(x−1)다. 3D는 x=cell.x,z=cell.y, 셀 크기 1이며 기존 −15.5 보정을 섞지 않는다. TracePoint만 교환 중점의 0.5 좌표를 허용한다.
- matchId는 로비 라운드부터 유지하고 새 라운드에 교체한다. serverTick은 연습을 포함해 50ms/20Hz로 연속 증가한다. 본 경기 로딩에서 matchId와 Tick을 다시 만들지 않는다.
- PLAYING startTick과 deadlineTick=startTick+3600을 고정한다. 이동 9 Tick·회전 6 Tick이다. startAt/서버 timeout은 서버 monotonic ms, JWT 만료/회수는 epoch 초다.
- 웹 표시 시간은 `clock-probe/clock-reply`로 추정한다. 시작·재접속 뒤 5회 probe를 250ms 간격으로 보내고 RTT가 가장 작은 3회의 offset 중앙값을 사용한다. RTT=(수신클라이언트시각−clientSentAtMs)−(serverSentAtMs−serverReceivedAtMs), offset=((serverReceivedAtMs−clientSentAtMs)+(serverSentAtMs−클라이언트수신시각))/2다. 음수/RTT>1000ms 표본은 버리고 10초마다 재측정한다. serverEpoch가 바뀌면 표본을 폐기한다.
- 클라이언트 추정 시각은 렌더링/안내용이다. serverTick·startAt·포즈 최소 시간을 브라우저 시계와 직접 비교하지 않고 환산한다. 실제 성공 판정은 서버가 한다.
- B의 온라인 맵 선택은 A Generator의 `next()` 전후로 monotonic deadline을 확인한다. 첫 구현 설정은 maxAttempts=256, onlineMapBudgetMs=100, 한 next의 후보 상한=8이다. 이는 버전 관리할 계산 예산이며 게임 밸런스 값이 아니다. 유한 그리드 검사 후 다음 묶음 전에 이벤트 루프로 반환한다. 같은 스레드의 setTimeout이 동기 무한 루프를 중단한다고 가정하지 않는다. 인증 fallback은 먼저 검증하고, 시간/시도 소진 시 iterator.return(인증 결과)로 종료한다.

## 명령의 접수와 종결

채널은 아래 ClientMessages/ServerMessages의 정확한 키를 사용한다. 구조는 `contracts/types.ts`의 판별 가능한 타입을 기준으로 strict 런타임 스키마로 구현한다. 모르는 필드·범위 밖 좌표·안전 정수가 아닌 sequence·잘못된 UUID는 거절한다. 신원은 인증된 연결에서만 주입한다.

1. B는 인증·봉투·단계별 기본 조건·큐 한도를 검사하고 `command-result`를 보낸다. accepted는 큐 접수다. rejected이면 큐에 넣지 않으며 별도 실행 결과는 없다.
2. **accepted인 모든 명령은 반드시 한 개의 논리적 command-outcome으로 종결한다.** A의 순수 명령은 StepResult.outcomes, B의 READY/LOAD_READY/REMATCH는 B 단계 처리 결과에서 만든다. 실패로 상태가 전혀 변하지 않아도 requestId/sequence에 연결해 보낸다.
3. applied는 의도 반영·행동 예약·교환/도전 생성 등이 처리됐다는 뜻이다. 이동 도착·설치 완료·탈출 성공은 이후 권위 상태/사건으로 확인한다. 적용 후 다른 판정으로 취소되어도 같은 명령의 terminal 결과를 다시 바꾸지 않는다.
4. 동일 requestId/동일 내용은 최초 접수/종결 결과를 재전송하고 core를 다시 호출하지 않는다. 다른 내용 재사용은 STALE_REQUEST로 거절한다. pending 요청은 캐시에서 퇴출하지 않는다. 연결별 pending 최대 64, completed 최대 512개/2분으로 제한하고 큐를 넣기 전에 한도를 검사한다. 매치 종료 때 미처리 수용 요청은 ROUND_ENDED의 canceled로 정리한다.
5. C는 접수 결과가 rejected이면 즉시 pending을 끝내고 안전 code와 재요청 UI를 표시한다. 이 경우 outcome·조회 타이머를 기다리지 않는다. accepted만으로 spinner를 끝내거나 성공을 표시하지 않는다. outcome을 받으면 요청 pending은 끝내고 필요한 private-view/event를 별도로 기다린다. EXIT_START가 rejected/canceled이면 재요청 UI를 복구하며 challenge를 만들어내지 않는다.
6. accepted 후 2초 동안 종결이 없으면 request-status를 요청한다. 2초 간격 최대 3회, done이면 결과 적용, pending이면 대기한다. unknown/연속 무응답은 개인 뷰 resync와 UNCONFIRMED 안내로 spinner를 끝내며 성공/실패로 추정하거나 자동 재실행하지 않는다.
7. command-outcome.stateVersion은 수신자가 필요한 개인 뷰 버전이다. 개인 내용 변경이 없으면 마지막 개인 뷰 버전을 사용한다. 아직 개인 뷰가 없는 로비의 READY 결과는 해당 공개 라운드 버전이며 C는 존재하지 않는 개인 뷰를 기다리지 않는다.

필수 연결 시험은 **accepted → core 거절(상태 불변) → requestId에 맞는 outcome → UI pending 종료 → 새 요청 가능**이다. 동일 요청 재전송·매치 종료·결과 지연·상태 조회도 실제 A/B/C 코드로 검사한다.

## 개인 상태·출구·교환·준비

개인 뷰는 초기/허용 내용 변경/명시적 resync 때 전체 교체한다. stateVersion 증가만으로 같은 지형을 계속 전송하지 않는다. 사건 stateVersion은 참조 개인 뷰 버전이고 발생 시각은 tick이다. 미래 사건은 최대 64개/1초 대기 후 resync, 구 match·중복·만료 사건은 폐기한다.

- visibleEntities는 종류별 필수 필드가 다르다. **가시 sensor는 wall이 필수**이며 자기 기억인 ownedEquipment와 분리한다. sensor.cell은 접근 셀, wall은 실제 부착 면이다. 다른 장비 위치를 전원에게 전송하지 않는다.
- self.exchange의 incoming/outgoing은 수신자 기준이다. C는 incoming만 D의 incomingExchangeId로 보내고 요청자는 outgoing 대기를 표시한다. 서버는 toPlayerId만 수락할 수 있게 검사한다.
- C는 현재 가시 아군만 교환 후보로 삼는다. 기존 후보가 계속 보이면 유지하고, 없으면 셀 제곱 거리·동률 playerId 순으로 고른다. 후보 선택은 서버의 거리·활동·지식 차이 검사를 대신하지 않는다.
- **READY true는 DEVICE_CHECK에서 로컬 장치 점검을 완료했다는 클라이언트 신고**다. 카메라·vision·calibration이 ready일 때만 보내고 장치 장애·취소는 false로 갱신한다. 마이크는 선택이다. 서버는 신고·인원·단계를 검증하며 원격 웹캠 정상 여부를 독립 증명한다고 쓰지 않는다.
- vision ready는 모델 로드만 뜻하지 않는다. 현재 유효 얼굴·첫 안전 가공 프레임·살아있는 가공 트랙까지 확보해야 한다. 실패 원인은 DeviceStatus.errorCode로 보고한다.
- 미니맵은 기억한 허용 출구를 표시할 수 있지만, **3D 포털·소유자 식별은 현재 관찰 중인 출구 벽면에만** 그린다. 폐쇄 시 같은 벽면의 일반 벽을 복원한다. 술래에게 출구를 보내지 않는다.
- 포즈 탈출 완료는 C가 단독 전송한다. 새롭고 유효한 동일 pose 관측으로 1.2초 유지하고 minSuccessTick도 충족해야 한다. 키 폴백은 challengeId 해시로 고정한 4방향 순환 순서를 사용한다. 최소 시간 조기 거절은 동일 도전·기한·유효 조건을 재확인한 경우에만 새 requestId로 제한 재시도한다.

## 서버 미디어와 브라우저 결합

mediaInstanceId는 팀별 연습/본 경기의 논리 미디어 인스턴스다. receiverGeneration은 이 메시지를 받는 플레이어 자신의 연결 세대, participants의 publisherGeneration은 원격 송신자 세대다. bindingRevision은 수신자·인스턴스·연결 세대 안에서 증가하며, 한 사람만 재연결했다고 다른 다섯 명의 receiverGeneration을 바꾸지 않는다. 새 Identity는 회수 완료 후에만 발급한다.

- E는 내부 Gateway·Journal·예산 큐를 소유한다. B가 주입하는 deps/config와 요청·trusted frame·비동기 결과는 아래 정확한 타입을 따른다. E 콜백은 B의 큐로만 들어가며 Tick 상태를 직접 변경하지 않는다.
- prepareGeneration은 expectedPreviousGeneration을 검사하고 E가 새 세대를 할당한다. 동일 requestId는 같은 논리 결과를 반환한다. Promise 결과는 HTTP 응답용이고 enqueueControl 결과는 게임 큐용이며 B는 requestId+scope로 중복 적용을 막는다. rejected/unknown이면 grant는 null이고, 세대 할당 전 rejected의 receiverGeneration은 null이다. ready는 grant 발급 완료이며 게시 확인 완료가 아니다. 요청 없이 생긴 MEDIA_FAILED는 eventId+scope로 중복 제거한다.
- media-bindings에는 자기 게시를 서버가 확인한 self 항목도 포함할 수 있다. 이때 publisherGeneration=receiverGeneration이다. B는 현재 scope의 self faceTrackSid 확인과 클라이언트 LOAD_READY를 모두 받아 로딩 장벽을 통과시킨다. D는 self 항목을 원격 얼굴/음성 attach 대상으로 사용하지 않는다. A의 self.loading은 null이며 B가 로딩 조정 상태를 덧붙인다.
- observeFrame은 게임의 권위 좌표·지형·현재 참가 상태만 받는다. E가 자신의 확인된 Identity/SID 레지스트리와 결합한다. 동기 호출 구간에 네트워크 대기·파일 쓰기·긴 계산을 넣지 않는다.
- 서버는 `media-bindings`, `audio-policy` 채널로 전체 허용 목록을 전송한다. AudioPolicy의 scope·bindingRevision이 현재 바인딩과 맞아야 적용한다. 같거나 낮은 policyRevision은 중복/과거로 폐기한다. 비어 있는 최신 voices는 기존 음성을 즉시 닫는다.
- D는 트랙·바인딩·음향 정책을 각각 저장하고 **어느 입력이 바뀌어도 reconcile**한다. 알 수 없는 트랙은 화면/오디오에 붙이지 않는다. 보류는 최대 12개/2초, 넘으면 detach/구독 중지 및 bindings-refresh를 요청한다. 바인딩이 뒤늦게 오면 SDK에 이미 존재하는 publication도 다시 대조한다. nickname/metadata로 매핑을 추측하지 않는다.
- 바인딩 refresh는 B의 현재 검증 목록 재전송이며 임의 Cloud 조회 증폭을 허용하지 않는다. 수신자당 1초에 1회로 제한한다. 목록이 불명확하면 E의 공유 예산 대조 큐에 합쳐 신규 허용을 막는다.
- AudioPolicy가 바인딩보다 미래이면 최대 1개 최신 정책을 2초 보류한다. 과거 바인딩 정책은 폐기한다. 트랙 없이 온 정책은 최신 상태로 보관하고 트랙 도착 시 재대조한다. scope가 바뀌면 pending과 실제 그래프를 함께 비운다.
- 가청은 미허용 pair의 거리≤5에서 진입, 이미 허용된 pair의 거리>6에서 이탈한다. 시험은 **5→6→7→6→5**로 하며 이전 허용 상태를 함께 기록한다.
- 서버 Webhook은 track_published/track_unpublished/participant_joined/participant_left/participant_connection_aborted 등 실제 서버 이름을 쓴다. D의 RoomEvent와 B의 클라이언트 신고를 혼합하지 않는다. 서명 검증·역순/중복 처리, 누락 대비 대조는 공유 API 예산 안에서 실행한다.
- **새 SID 게시**는 기본 차단→확인→현재 정책 허용, **같은 SID replaceTrack**은 기존 권한·새 표식·불허 수신 유지, **전체 재연결**은 옛 Identity 회수·새 세대 격리로 각각 시험한다. 같은 SID 소스 교체에 새 Webhook이 반드시 온다고 가정하지 않는다.
- D가 video/track·장치를, C가 VideoTexture를 소유한다. onFaceTrack의 null은 기존 텍스처 해제 신호다. onLocalPreview는 DEVICE_CHECK용 원본 미리보기이며 게시 트랙이 아니다.

## 센서·입력 callback 수명

한 SensorSnapshot의 emittedAtMs를 새 센서 관측으로 해석하지 않는다. 각 Sample은 실제 프레임의 sampledAtMs/frameId를 보존한다. 해당 모델을 실행하지 않은 발행에서는 Sample을 갱신하지 않는다. 미검출은 새 frameId의 missing/null이며, 세대 시작부터 아직 실행하지 않은 센서는 null이다.

- sampledAtMs/receivedAtMs/emittedAtMs는 브라우저 main performance 시간축이다. Worker는 main이 전달한 frameId·sampledAtMs를 그대로 돌려주고 main이 receivedAtMs를 붙인다. 서버 시계와 섞지 않는다.
- face/pose age>300ms, gesture age>400ms면 사용 불가다. C의 pose 유지 누적은 증가한 pose.frameId만 사용하고 유효 표본 사이 간격≤300ms여야 한다. 미검출·uncertain·만료·구 세대는 누적을 초기화한다.
- 두 손이 서로 다른 유효 제스처를 보이면 none이다. 같은 종류면 최고 score 한 개를 선택한다. 손별 후보 배열을 다른 모듈로 넘기지 않는다.
- D는 위치/좌우/유효성을 정규화하고 C는 탈출 포즈 임계값을 소유한다. sensorTuningVersion은 D, poseTuningVersion은 C가 검사 증거에 남긴다.
- startDevices는 중복 카메라 취득을 합치고 dispose 중 늦은 결과는 즉시 닫는다. callback 등록은 기동 전이다. 새 세대 시작 시 이전 onFaceTrack null·미디어 closed를 먼저 알리고 새 상태를 내보낸다. dispose 완료 뒤 callback은 발생하지 않는다.
- pageActive=false이면 입력·버퍼를 비우고 새 의도를 막는다. 복귀 때 새 키/중립 복귀를 요구하며 서버 phase를 꾸며내지 않는다.
- C가 장치/미디어·교환·출구 문맥을 setContext로 반영한다. D가 슬롯·입력 모드를 바꾸면 onInteractionState로 알리고 같은 값의 재적용은 callback을 반복하지 않는다.

## 운영 HTTP 계약

B가 경로를 등록하고 E가 핸들러를, F가 secret 주입·배포 보호를 맡는다. 세션용 Bearer와 운영용 OPS_TOKEN을 혼용하지 않는다. 운영 명령은 실제 운영 작업을 승인받은 실행에서만 호출하며 문서 작성만으로 원격 실행하지 않는다.

B는 coordinator.getOperations()의 OperationsPort를 위임받아 submit/getSnapshot/getStatus를 각 경로에 연결한다. submit은 accepted+snapshot 또는 conflict를 즉시 반환하고 긴 작업은 E 내부 큐에서 처리한다. drain 접수 시 admission을 먼저 DRAINING으로 바꾼다. B는 입장 승인 직전에 getStatus().admission을 검사하며 await 뒤에도 재검사한다. E는 주입된 getGameActivity()의 진행 경기·연습·입장 수가 모두 0이고 회수가 확인되어야 drain을 succeeded로 바꾼다. 시간 초과는 failed로 종결하고 신규 입장 차단을 유지한다. E가 B의 Room registry를 직접 수정하거나 정의되지 않은 callback을 추가하지 않는다.

- POST /api/sessions: SessionRequest → SessionResponse. 신원은 서버가 발급하고 no-store·메모리 보관, fragment 초대는 읽은 뒤 주소에서 지운다. SessionResponse.expiresAt은 epoch ms이며 MediaGrant.expiresAt은 epoch 초다.
- POST /api/media/grants: Bearer 세션 + MediaGrantRequest → MediaGrant. 이전 회수/예산/phase 불충족은 409, 인증 오류 401/403, 공급자 불명 503으로 안전 code만 반환한다.
- POST /api/media/report: Bearer 세션 + MediaStatusReport → 204. 수신자 신원과 scope를 검사한다. 신고만으로 원격 회수·권한 성공을 확정하지 않는다.
- POST /api/livekit/webhook: raw body + 공급자 Authorization을 E가 검증하며 JSON 재직렬화·인증 생략을 하지 않는다.
- POST /api/operations/commands: OPS_TOKEN + OperationsCommand → 202 OperationSnapshot(pending). 같은 requestId/같은 본문은 같은 operationId, 다른 본문 재사용은 409다. retry-retirement에만 retirementId를 요구한다.
- GET /api/operations/commands/:requestId: OPS_TOKEN → 200 OperationSnapshot 또는 404. 완료 상태는 succeeded/failed이며 HTTP 202를 작업 성공으로 해석하지 않는다.
- GET /api/operations/status: OPS_TOKEN → OperationsStatus. remaining 값이 null이면 미확인이고 0으로 바꾸지 않는다.
- /health/live는 프로세스 생존, /health/ready는 회수·저널·예산·인증 준비의 conjunction이다. RECOVERING을 재시작 루프로 우회하지 않는다.
- admission과 readiness는 독립이다. 정상 drain은 admission만 DRAINING으로 바꾸고 건강한 readiness는 READY를 유지한다. 새 입장/grant는 readiness=READY이고 admission=OPEN일 때만 허용한다. resume은 READY를 확인한 뒤 OPEN으로 전환한다. 실제 저널·보안·예산 장애는 readiness를 LOCKED로 만든다.
- checkpoint-budget는 `OPS_DATA_DIR/official-usage-input.json`의 OfficialBudgetCheckpoint를 읽어 검증한다. F가 실제 Cloud 사용량 보고서의 조회 시각·잔량·근거를 넣고 E가 신선도·비음수·같은 프로젝트 여부를 검사한다. 예시 잔량이나 클라이언트 신고를 공식 증거로 쓰지 않는다.

## 작업 상태·커밋·MR·인계

실행 상태는 PLANNED → CONTRACT_READY → LOCAL_VERIFIED → INTEGRATED → ACCEPTED로 기록한다. 외부 전제 부재는 BLOCKED, 미정 콘텐츠는 PRODUCT_DECISION_PENDING이다. 이 상태는 문서/로컬 진행 기록이며 Jira 상태를 자동 변경하지 않는다.

1. 계약/fixture 또는 단위 구현이 검증되면 **중간 커밋을 허용한다.** 작업 ID·이번 단계·실제 검증·미통합 조건을 커밋/MR에 적는다. 깨진 빌드·빈 성공 stub을 인계하지 않는다.
2. 담당의 완료 조건과 실제 생산자·소비자 연결, 필요한 Cloud/장치 증거가 있어야 ACCEPTED다. 중간 커밋/합병을 기능 완료로 세지 않는다. 완료마다 최종 변경 커밋을 남기되 같은 결과를 중복 커밋하지 않는다.
3. git status/name/email을 확인하고 실제 담당자 신원을 유지한다. 타인 --author·신원 변경·AI 공동 저자·기존 커밋 재작성은 하지 않는다. 신원 누락 시 구현은 진행하되 커밋만 보류한다.
4. 실제 Jira가 있으면 정상 브랜치 형식을 사용한다. 없으면 담당/일차 feat/mvp-a-d1(F는 ci/mvp-f-d1)처럼 쓰고 가짜 키를 만들지 않는다. 기존 담당 브랜치와 다른 미커밋 변경을 먼저 확인한다.
5. 해당 파일만 명시적으로 stage하고 diff를 확인한다. 제목은 scope 없는 type: 변경 내용, Jira 키는 실제 키만 마지막 문단에 단독 줄로 넣는다. Refs:와 AI 공동 저자는 넣지 않는다. 한글 메시지는 UTF-8 파일과 git commit -F로 전달한다.
6. .local/execution/<담당>.json에 ID/단계/검증/commit/선행 통합/결정 대기를 기록한다. .local/mr/<담당>/<ID>.md와 <일차>-combined.md에 아래 다섯 항목의 완성된 MR 본문을 작성하고 파일 링크와 전체 본문을 담당자에게 제공한다.
7. 중간 인계 시점마다 담당자가 직접 push·MR 생성·리뷰·병합한다. AI가 원격 작업을 대신하지 않는다. 이후 선행 코드를 반영해 연결 시험을 수행한다.

```markdown
## 관련 Jira

실제 키 또는 미등록 사유, 담당 고정 번호와 원본 ID

## 변경 사항

실제 변경 동작·파일·commit SHA, CONTRACT_READY/LOCAL_VERIFIED/INTEGRATED/ACCEPTED 단계

## 변경 이유

이전 동작의 문제와 이번 단계에서 가능해진 동작

## 리뷰 포인트

공개 타입·실패 처리·수명·정보 은폐, 필요한 생산자/소비자 확인, 선행 반영 상태

## see also

기획 장·최신 결정·계약 버전·실제 검사 결과·미검증/결정 대기 항목
```

## 타입·fixture와 필수 연결 시험

아래 타입은 [검사 가능한 원본](contracts/types.ts)에서 자동 삽입한다. [fixture](contracts/fixtures.ts)는 정상/실패·순서 교차 입력과 기대 상태를 제공하고 [검사](contracts/fixtures.test.ts)는 계약 자료의 정합성을 확인한다. 제품 타입·serializer·reducer·Room·Coordinator 구현과 실제 연결은 각 담당 작업에서 수행한다. 문서용 타입을 제품 런타임 의존성으로 import하지 않는다. 필요한 공개 타입은 해당 소유 모듈에 옮기고 원본과 소비자 호환을 검사한다.

필수 계약 연결 사례: accepted 후 core 거절, 요청 중 매치 종료/중복/조회, 한 명만 미디어 세대 교체, 트랙/바인딩 양쪽 순서와 오디오 세 입력 순열, 같은 SID/새 SID 구분, 얼굴만 새 결과와 오래된 pose, 양손 충돌, 요청자/수락자 다른 UI, READY false 취소, 비소유자 가시 sensor.wall, 관찰 출구 표시/폐쇄, 5→6→7 음성 차단. F가 실제 모듈을 연결하되 생산자와 소비자가 자기 계약 시험을 먼저 제공한다.

<!-- BEGIN CONTRACT-TYPES -->

```ts
// EXEC-CONTRACT-2. Planning contracts; product modules do not exist merely because these types do.
export const CONTRACT_VERSION = 'EXEC-CONTRACT-2' as const;
export const SCOPE_VERSION = 'D-2026-09-08-01' as const;
export type Cell = Readonly<{ x: number; y: number }>;
export type TracePoint = Readonly<{ x: number; y: number }>;
export type Dir = 0 | 1 | 2 | 3;
export type WallFace = Cell & Readonly<{ side: Dir }>;
export type Role = 'runner' | 'tagger';
export type SessionRequest = Readonly<{ nickname: string; inviteToken: string }> &
  ({ createRoom: true; roomCode?: never } | { createRoom: false; roomCode: string });
export type SessionResponse = Readonly<{
  sessionToken: string;
  playerId: string;
  roomCode: string;
  expiresAt: number;
  protocolVersion: '0.2.0';
}>;
export type PlayerStatus = 'ACTIVE' | 'ESCAPED' | 'CAPTURED';
export type Phase =
  | 'LOBBY'
  | 'DEVICE_CHECK'
  | 'TEAM_PRACTICE'
  | 'MAP_FINALIZING'
  | 'GAME_LOADING'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'RESULT'
  | 'ABORTED';
export type EquipmentKind = 'sensor' | 'trap';
export type PoseKind = 'left' | 'right' | 'y';
export type Action = Readonly<{
  kind: 'move' | 'turn';
  from: Cell & { dir: Dir };
  to: Cell & { dir: Dir };
  startTick: number;
  endTick: number;
}>;
export type CommandCode =
  | 'INVALID_COMMAND'
  | 'PROTOCOL_MISMATCH'
  | 'WRONG_MATCH'
  | 'RATE_LIMITED'
  | 'INVALID_PHASE'
  | 'NOT_ACTIVE'
  | 'NOT_ALLOWED'
  | 'EXPIRED'
  | 'STALE_REQUEST'
  | 'NOT_READY'
  | 'QUEUE_FULL'
  | 'ROUND_ENDED'
  | 'CANCELED';
export type CommandPayloads = {
  MOVE_INTENT: { direction: 'forward' | 'back' | null };
  TURN: { direction: 'left' | 'right' };
  READY: { ready: boolean };
  PRACTICE_READY: { ready: boolean };
  LOAD_READY: { loadId: string; mediaInstanceId: string; receiverGeneration: number };
  EXCHANGE_REQUEST: { targetPlayerId: string };
  EXCHANGE_ACCEPT: { exchangeId: string };
  EXCHANGE_CANCEL: { exchangeId: string };
  INSTALL: { kind: EquipmentKind };
  INSTALL_CANCEL: { installationId: string };
  EXIT_START: { exitId: string };
  EXIT_CANCEL: { challengeId: string };
  EXIT_PROGRESS: { challengeId: string; method: 'pose' | 'keys'; completed: boolean };
  REMATCH: { mode: 'same' | 'swap' | 'lobby' };
};
export type CommandType = keyof CommandPayloads;
export type CommandEnvelope<K extends CommandType = CommandType> = {
  [T in K]: Readonly<{
    matchId: string;
    requestId: string;
    sequence: number;
    type: T;
    payload: CommandPayloads[T];
  }>;
}[K];
export type CommandReceipt = Readonly<{
  matchId: string;
  requestId: string;
  sequence: number;
  stateVersion: number;
}> &
  ({ status: 'accepted'; code: null } | { status: 'rejected'; code: CommandCode });
export type OutcomeResult =
  { result: 'applied'; code: null } | { result: 'rejected' | 'canceled'; code: CommandCode };
export type CommandOutcome = Readonly<{
  matchId: string;
  requestId: string;
  sequence: number;
  tick: number;
  stateVersion: number;
}> &
  OutcomeResult;
export type RequestStatus = Readonly<{ matchId: string; requestId: string }>;
export type RequestStatusResult = RequestStatus &
  ({ status: 'done'; outcome: CommandOutcome } | { status: 'pending' | 'unknown'; outcome: null });
export type ExchangeView = Readonly<{
  exchangeId: string;
  fromPlayerId: string;
  toPlayerId: string;
  direction: 'incoming' | 'outgoing';
  expiresAtTick: number;
}>;
export type InstallationView = Readonly<{
  installationId: string;
  kind: EquipmentKind;
  startTick: number;
  endTick: number;
  armedTick: number;
}>;
export type ChallengeView = Readonly<{
  challengeId: string;
  exitId: string;
  poseKind: PoseKind;
  startedAtTick: number;
  minSuccessTick: number;
  expiresAtTick: number;
}>;
export type LoadingView = Readonly<{
  loadId: string;
  initialViewVersion: number;
  mediaInstanceId: string;
  receiverGeneration: number;
  assetVersion: string;
}>;
export type OwnedEquipment = Readonly<{
  equipmentId: string;
  state: 'UNARMED' | 'ARMED' | 'SPENT';
  armedTick: number;
}> &
  ({ kind: 'sensor'; cell: Cell; wall: WallFace } | { kind: 'trap'; cell: Cell });
export type ActiveSelf = Readonly<{
  playerId: string;
  role: Role;
  status: 'ACTIVE';
  cell: Cell;
  dir: Dir;
  action: Action | null;
  equipment: { sensor: number; trap: number };
  ownedEquipment: readonly OwnedEquipment[];
  restraintUntilTick: number | null;
  restraintImmuneUntilTick: number | null;
  installation: InstallationView | null;
  exchange: ExchangeView | null;
  challenge: ChallengeView | null;
  loading: LoadingView | null;
}>;
export type EndedSelf = Readonly<{ playerId: string; role: Role; status: 'ESCAPED' | 'CAPTURED' }>;
export type VisibleEntity =
  | Readonly<{
      id: string;
      kind: 'player';
      cell: Cell;
      dir: Dir;
      action: Action | null;
      role?: Role;
    }>
  | Readonly<{ id: string; kind: 'sensor'; cell: Cell; wall: WallFace; state: 'UNARMED' | 'ARMED' }>
  | Readonly<{ id: string; kind: 'trap'; cell: Cell; state: 'UNARMED' | 'ARMED' }>;
export type KnownTerrain =
  Readonly<Cell & { kind: 'floor' }> | Readonly<WallFace & { kind: 'wall' }>;
export type KnownExit = Readonly<{
  exitId: string;
  ownerId: string;
  wall: WallFace;
  approach: Cell;
}>;
export type PlayerKnowledge = Readonly<{
  mapVersion: number;
  knownTerrain: readonly KnownTerrain[];
  knownActiveExits: readonly KnownExit[];
}>;
export type PrivateView = PlayerKnowledge &
  Readonly<{
    matchId: string;
    stateVersion: number;
    self: ActiveSelf | EndedSelf | null;
    visibleCells: readonly Cell[];
    visibleWallFaces: readonly WallFace[];
    visibleEntities: readonly VisibleEntity[];
  }>;
export type Counts = Readonly<{ escaped: number; captured: number }>;
export type RoundResult = Readonly<{
  winner: 'runners' | 'taggers';
  reason: 'two-escaped' | 'two-captured' | 'timeout';
}>;
export type AbortReason =
  'GAME_CONNECTION_LOST' | 'SERVER_TICK_OVERLOAD' | 'MEDIA_POLICY_UNCERTAIN' | 'MEDIA_UNAVAILABLE';
export type PublicRoundState = Readonly<{
  phase: Phase;
  matchId: string;
  stateVersion: number;
  serverTick: number;
  startTick: number | null;
  startAt: number | null;
  deadlineTick: number | null;
  counts: Counts;
  result: RoundResult | null;
  abortReason: AbortReason | null;
}>;
export type RoomRoster = Readonly<{
  matchId: string;
  stateVersion: number;
  phase: Phase;
  hostId: string;
  players: readonly { playerId: string; nickname: string; ready: boolean; connected: boolean }[];
}>;
export type EventPayloads = {
  EXCHANGE_OFFER: { exchangeId: string; fromPlayerId: string; expiresAtTick: number };
  EXCHANGE_CANCELED: { exchangeId: string; reason: CommandCode };
  EXCHANGE_COMPLETED: { exchangeId: string; mapVersion: number };
  HUNTER_MARKER: {
    markerId: string;
    kind: 'exchange' | 'sensor' | 'trap';
    point: TracePoint;
    occurredTick: number;
    showAtTick: number;
    expiresTick: number;
  };
  EXIT_CHALLENGE: ChallengeView;
  EXIT_CHALLENGE_ENDED: {
    challengeId: string;
    result: 'canceled' | 'failed' | 'escaped';
    reason: CommandCode | null;
  };
};
export type EventType = keyof EventPayloads;
export type PrivateEvent = {
  [K in EventType]: Readonly<{
    matchId: string;
    eventId: string;
    tick: number;
    stateVersion: number;
    type: K;
    payload: EventPayloads[K];
  }>;
}[EventType];
export type GameHeartbeat = Readonly<{
  serverEpoch: string;
  matchId: string;
  heartbeatSeq: number;
  serverTick: number;
  serverTimeMs: number;
}>;
export type HeartbeatAck = Readonly<{ serverEpoch: string; matchId: string; heartbeatSeq: number }>;
export type ClockProbe = Readonly<{ probeId: string; clientSentAtMs: number }>;
export type ClockReply = ClockProbe &
  Readonly<{ serverReceivedAtMs: number; serverSentAtMs: number; serverEpoch: string }>;
export type ViewResync = Readonly<{ matchId: string; lastStateVersion: number }>;
export type CoreCommandType = Exclude<
  CommandType,
  'READY' | 'PRACTICE_READY' | 'LOAD_READY' | 'REMATCH'
>;
export type CoreCommand = CommandEnvelope<CoreCommandType> & Readonly<{ actorId: string }>;
export type ControlIntent =
  | Readonly<{ type: 'EXPIRE_MOVE'; playerId: string; sequence: number }>
  | Readonly<{ type: 'CONNECTION_LOST'; playerId: string }>
  | Readonly<{ type: 'ABORT_MATCH'; reason: AbortReason }>
  | Readonly<{ type: 'START_PLAYING'; startTick: number }>;
export type CoreOutcome = Omit<CommandOutcome, 'stateVersion' | 'result' | 'code'> &
  OutcomeResult &
  Readonly<{ actorId: string }>;
export type DomainEvent =
  | {
      [K in EventType]: Readonly<{
        eventId: string;
        tick: number;
        audience: readonly string[];
        type: K;
        payload: EventPayloads[K];
      }>;
    }[EventType]
  | Readonly<{ type: 'SPATIAL_SOUND'; sound: SpatialSoundEvent }>;
export type MediaIntent =
  | Readonly<{
      type: 'RETIRE_PLAYER';
      playerId: string;
      reason: 'personal-ended' | 'connection-lost';
    }>
  | Readonly<{ type: 'RETIRE_INSTANCE'; reason: 'phase-change' | 'round-ended' | 'aborted' }>;
export type StepResult<State> = Readonly<{
  state: State;
  outcomes: readonly CoreOutcome[];
  events: readonly DomainEvent[];
  mediaIntents: readonly MediaIntent[];
}>;
export type Topology = Readonly<{
  topologyVersion: string;
  width: number;
  height: number;
  walkable: readonly boolean[];
}>;
export type MatchLayout = Readonly<{
  layoutId: string;
  topology: Topology;
  players: readonly { playerId: string; role: Role; cell: Cell; dir: Dir }[];
  exits: readonly (KnownExit & { poseKind: PoseKind })[];
  territories: readonly { playerId: string; cells: readonly Cell[] }[];
}>;
export type MatchTuning = Readonly<{
  tuningVersion: string;
  tickMs: 50;
  moveTicks: 9;
  turnTicks: 6;
  roundTicks: 3600;
  installationTicks: 10;
  armTicks: 20;
  restraintTicks: 30;
  restraintImmunityTicks: 40;
  exchangeExpiryTicks: 40;
  exitMinimumTicks: 40;
  exitExpiryTicks: 160;
  exitRetryTicks: 10;
}>;
export type CreateMatchInput = Readonly<{
  matchId: string;
  seed: number;
  tuning: MatchTuning;
  layout: MatchLayout;
  players: readonly { playerId: string; role: Role }[];
}>;
export type CreatePracticeInput = CreateMatchInput &
  Readonly<{ mediaInstanceId: string; role: Role }>;
export type GameSubject = Readonly<{
  playerId: string;
  role: Role;
  status: PlayerStatus;
  cell: Cell;
  dir: Dir;
  action: Action | null;
}>;
export type CoreReadFrame = Readonly<{
  matchId: string;
  tick: number;
  phase: Phase;
  counts: Counts;
  result: RoundResult | null;
  abortReason: AbortReason | null;
  participants: readonly GameSubject[];
}>;
export interface CorePort<State> {
  createMatch(input: CreateMatchInput): State;
  createPractice(input: CreatePracticeInput): State;
  stepMatch(
    state: State,
    input: { tick: number; commands: readonly CoreCommand[]; controls: readonly ControlIntent[] },
  ): StepResult<State>;
  getPlayerKnowledge(state: State, playerId: string): PlayerKnowledge;
  getVisibleEntities(state: State, playerId: string): readonly VisibleEntity[];
  getPlayerSelf(state: State, playerId: string): ActiveSelf | EndedSelf | null;
  getVisibleSurfaces(
    state: State,
    playerId: string,
  ): { visibleCells: readonly Cell[]; visibleWallFaces: readonly WallFace[] };
  getFrame(state: State): CoreReadFrame;
}
export type SelectionProgress = Readonly<{ attempted: number; batchAttempts: number }>;
export type LayoutSelectionResult =
  | Readonly<{ status: 'selected'; layout: MatchLayout; source: 'online' | 'fallback' }>
  | Readonly<{ status: 'unavailable'; code: 'LAYOUT_UNAVAILABLE' }>;
export type LayoutSelectionInput = Readonly<{
  template: Topology;
  players: readonly { playerId: string; role: Role }[];
  spawnCandidates: readonly Cell[];
  exitCandidates: readonly WallFace[];
  territories: MatchLayout['territories'];
  seed: number;
  maxAttempts: number;
  fallback: MatchLayout;
}>;
export interface LayoutSelectionPort {
  certifyFallback(input: LayoutSelectionInput): LayoutSelectionResult;
  selectWithFallback(
    input: LayoutSelectionInput,
  ): Generator<SelectionProgress, LayoutSelectionResult, void>;
}
export type MediaScope = Readonly<{
  matchId: string;
  mediaInstanceId: string;
  receiverGeneration: number;
}>;
export type MediaBinding = Readonly<{
  playerId: string;
  publisherGeneration: number;
  mediaIdentity: string;
  participantSid: string;
  faceTrackSid?: string;
  audioTrackSid?: string;
}>;
export type MediaBindings = MediaScope &
  Readonly<{ bindingRevision: number; participants: readonly MediaBinding[] }>;
export type AudioPolicy = MediaScope &
  Readonly<{
    policyRevision: number;
    bindingRevision: number;
    stateVersion: number;
    voices: readonly {
      playerId: string;
      trackSid: string;
      gain: number;
      azimuthRad: number;
      lowpassHz: number;
    }[];
    effects: readonly {
      eventId: string;
      kind: 'footstep' | 'sensor' | 'trap';
      gain: number;
      azimuthRad: number;
      lowpassHz: number;
      tick: number;
    }[];
  }>;
export type MediaGrant = MediaScope &
  Readonly<{
    url: string;
    token: string;
    roomName: string;
    mediaIdentity: string;
    expiresAt: number;
  }>;
export type MediaGrantRequest = Readonly<{
  matchId: string;
  purpose: 'practice' | 'game';
  previousReceiverGeneration?: number;
}>;
export type MediaStatusReport = MediaScope &
  Readonly<{ status: 'ready' | 'recovering' | 'failed' | 'closed' }>;
export type MediaRefreshRequest = MediaScope & Readonly<{ lastBindingRevision: number }>;
export type MediaFailureCode =
  | 'NOT_READY'
  | 'WRONG_SCOPE'
  | 'BUDGET_EXHAUSTED'
  | 'RETIREMENT_UNCONFIRMED'
  | 'POLICY_UNKNOWN'
  | 'REMOTE_UNAVAILABLE'
  | 'STALE_GENERATION'
  | 'TIMEOUT';
export type PrepareGenerationRequest = Readonly<{
  requestId: string;
  matchId: string;
  playerId: string;
  mediaInstanceId: string;
  purpose: 'practice' | 'game';
  expectedPreviousGeneration: number | null;
}>;
export type PreparationResult = Readonly<{
  requestId: string;
  matchId: string;
  playerId: string;
  mediaInstanceId: string;
}> &
  (
    | { status: 'ready'; receiverGeneration: number; grant: MediaGrant; code: null }
    | { status: 'unknown'; receiverGeneration: number; grant: null; code: MediaFailureCode }
    | { status: 'rejected'; receiverGeneration: number | null; grant: null; code: MediaFailureCode }
  );
export type RetireGenerationRequest = MediaScope &
  Readonly<{
    requestId: string;
    playerId: string;
    reason:
      | 'phase-change'
      | 'personal-ended'
      | 'connection-lost'
      | 'policy-unknown'
      | 'round-ended'
      | 'reconnect'
      | 'shutdown';
  }>;
export type RetirementResult = RetireGenerationRequest &
  ({ status: 'confirmed'; code: null } | { status: 'unknown'; code: MediaFailureCode });
export type TrustedMediaFrame = Readonly<{
  matchId: string;
  mediaInstanceId: string;
  instancePurpose: 'practice' | 'game';
  frameRevision: number;
  tick: number;
  phase: Phase;
  topology: Topology;
  participants: readonly GameSubject[];
  events: readonly SpatialSoundEvent[];
}>;
export type SpatialSoundEvent = Readonly<{
  eventId: string;
  tick: number;
  kind: 'footstep' | 'sensor' | 'trap';
  cell: Cell;
  sourcePlayerId?: string;
}>;
export type MediaControl =
  | Readonly<{ type: 'MEDIA_PREPARED'; result: PreparationResult }>
  | Readonly<{ type: 'MEDIA_RETIRED'; result: RetirementResult }>
  | Readonly<
      MediaScope & {
        type: 'MEDIA_FAILED';
        eventId: string;
        playerId: string;
        code: MediaFailureCode;
      }
    >;
export type Readiness = Readonly<{
  state: 'READY' | 'RECOVERING' | 'LOCKED';
  reasonCodes: readonly string[];
  historyComplete: boolean;
  unresolvedCount: number;
}>;
export interface MediaCoordinator {
  prepareGeneration(input: PrepareGenerationRequest): Promise<PreparationResult>;
  observeFrame(frame: TrustedMediaFrame): void;
  retireGeneration(input: RetireGenerationRequest): Promise<RetirementResult>;
  handleWebhook(
    rawBody: string,
    authorization: string,
  ): Promise<{ status: 'accepted' | 'ignored' }>;
  getReadiness(): Readiness;
  getOperations(): OperationsPort;
  close(): Promise<void>;
}
export type MediaCoordinatorDeps = Readonly<{
  config: MediaConfiguration;
  enqueueControl: (control: MediaControl) => void;
  enqueueBindings: (playerId: string, message: MediaBindings) => void;
  enqueueAudioPolicy: (playerId: string, message: AudioPolicy) => void;
  monotonicNow: () => number;
  epochNowSeconds: () => number;
  getGameActivity: () => Readonly<{
    activeMatches: number;
    activePractices: number;
    pendingAdmissions: number;
  }>;
}>;
export type MediaConfiguration = Readonly<{
  httpUrl: string;
  wsUrl: string;
  apiKey: string;
  apiSecret: string;
  namespace: string;
  opsDataDir: string;
  initialBudget: {
    remainingMinutes: number;
    remainingBytes: number;
    checkedAtEpochMs: number;
  } | null;
  maxConcurrentParticipants: number;
  maxNormalApiCallsPer60s: number;
  maxTotalApiCallsPer60s: number;
}>;
export type CreateMediaCoordinator = (deps: MediaCoordinatorDeps) => MediaCoordinator;
export type NormalizedLandmark = Readonly<{ x: number; y: number; z: number }>;
export type FaceSensor = Readonly<{
  landmarks: readonly NormalizedLandmark[];
  yawRad: number;
  quality: 'valid' | 'uncertain' | 'missing';
}>;
export type PoseSensor = Readonly<{
  landmarks: readonly (NormalizedLandmark & { visibility: number })[];
  quality: 'valid' | 'uncertain' | 'missing';
}>;
export type GestureSensor = Readonly<{ kind: 'palm' | 'victory' | 'none'; score: number }>;
export type Sample<T> = Readonly<{ frameId: number; sampledAtMs: number; receivedAtMs: number }> &
  ({ status: 'valid'; data: T } | { status: 'missing'; data: null });
export type SensorSnapshot = Readonly<{
  runtimeGeneration: number;
  emittedAtMs: number;
  face: Sample<FaceSensor> | null;
  pose: Sample<PoseSensor> | null;
  gesture: Sample<GestureSensor> | null;
}>;
export type DeviceStatus = Readonly<{
  camera: 'idle' | 'requesting' | 'ready' | 'failed';
  microphone: 'off' | 'requesting' | 'ready' | 'denied' | 'failed';
  vision: 'idle' | 'loading' | 'ready' | 'failed';
  calibration: 'idle' | 'running' | 'ready' | 'failed';
  audioPlayback: 'locked' | 'ready' | 'failed';
  errorCode: string | null;
}>;
export type MediaStatus = Readonly<{
  matchId: string | null;
  mediaInstanceId: string | null;
  receiverGeneration: number | null;
  state: 'idle' | 'connecting' | 'connected' | 'recovering' | 'closed' | 'failed';
  code: string | null;
}>;
export type InteractionContext = Readonly<{
  matchId: string;
  selfPlayerId: string;
  role: Role | null;
  phase: Phase;
  status: PlayerStatus;
  targetPlayerId?: string;
  incomingExchangeId?: string;
  outgoingExchangeId?: string;
  challengeId?: string;
  exitId?: string;
  poseKind?: PoseKind;
  selectedEquipment?: EquipmentKind;
  installationId?: string;
  mode: 'motion' | 'keyboard';
  pageActive: boolean;
}>;
export type InteractionState = Readonly<{
  selectedEquipment: EquipmentKind;
  mode: 'motion' | 'keyboard';
}>;
export type FaceTrackEvent = MediaScope &
  Readonly<{
    playerId: string;
    publisherGeneration: number;
    trackSid: string;
    element: HTMLVideoElement | null;
  }>;
export type CommandInput = {
  [K in CommandType]: { type: K; payload: CommandPayloads[K] };
}[CommandType];
export type InteractionDeps = Readonly<{
  sendCommand: (command: CommandInput) => string;
  requestMediaGrant: (request: MediaGrantRequest) => Promise<MediaGrant>;
  reportMediaStatus: (report: MediaStatusReport) => Promise<void>;
  requestBindingsRefresh: (request: MediaRefreshRequest) => void;
  onDeviceStatus: (status: DeviceStatus) => void;
  onFaceTrack: (event: FaceTrackEvent) => void;
  onMediaStatus: (status: MediaStatus) => void;
  onSensors: (snapshot: SensorSnapshot) => void;
  onInteractionState: (state: InteractionState) => void;
  onLocalPreview: (element: HTMLVideoElement | null) => void;
}>;
export interface InteractionRuntime {
  startDevices(input: { microphone: boolean }): Promise<DeviceStatus>;
  calibrate(): Promise<DeviceStatus>;
  setContext(context: InteractionContext): void;
  connectMedia(grant: MediaGrant): Promise<void>;
  applyAudioPolicy(policy: AudioPolicy): void;
  applyMediaBindings(bindings: MediaBindings): void;
  setQualityPreset(preset: 'medium' | 'low'): void;
  retireMediaGeneration(): Promise<void>;
  endParticipation(): Promise<void>;
  dispose(): Promise<void>;
}
export type CreateInteractionRuntime = (deps: InteractionDeps) => InteractionRuntime;
export type OperationsCommand =
  | Readonly<{ requestId: string; action: 'drain' | 'resume' | 'checkpoint' }>
  | Readonly<{ requestId: string; action: 'retry-retirement'; retirementId: string }>;
export type OperationSnapshot = Readonly<{
  requestId: string;
  operationId: string;
  action: OperationsCommand['action'];
  status: 'pending' | 'succeeded' | 'failed';
  code: string | null;
  updatedAtEpochMs: number;
}>;
export type OperationsStatus = Readonly<{
  admission: 'OPEN' | 'DRAINING' | 'LOCKED';
  readiness: Readiness['state'];
  unresolvedCount: number;
  remainingMinutes: number | null;
  remainingBytes: number | null;
  checkedAtEpochMs: number | null;
}>;
export type OperationSubmission =
  | Readonly<{ status: 'accepted'; snapshot: OperationSnapshot }>
  | Readonly<{ status: 'conflict'; code: 'REQUEST_ID_CONFLICT' }>;
export interface OperationsPort {
  submit(command: OperationsCommand): OperationSubmission;
  getSnapshot(requestId: string): OperationSnapshot | null;
  getStatus(): OperationsStatus;
}
export type OfficialBudgetCheckpoint = Readonly<{
  projectAlias: string;
  remainingMinutes: number;
  remainingBytes: number;
  checkedAtEpochMs: number;
  source: 'cloud-dashboard';
  checkedBy: string;
}>;
export type ClientMessages = {
  command: CommandEnvelope;
  'request-status': RequestStatus;
  'view-resync': ViewResync;
  'game-heartbeat-ack': HeartbeatAck;
  'clock-probe': ClockProbe;
  'media-bindings-refresh': MediaRefreshRequest;
};
export type ServerMessages = {
  'command-result': CommandReceipt;
  'command-outcome': CommandOutcome;
  'request-status-result': RequestStatusResult;
  'room-roster': RoomRoster;
  'private-view': PrivateView;
  'private-event': PrivateEvent;
  'game-heartbeat': GameHeartbeat;
  'clock-reply': ClockReply;
  'media-bindings': MediaBindings;
  'audio-policy': AudioPolicy;
};
```

<!-- END CONTRACT-TYPES -->

<!-- END EXEC-CONTRACT-2 COMMON -->

## 작업별 구현 지시

각 항목의 파일은 **수정 또는 생성할 예정 경로**다. 현재 존재 여부는 AI가 확인한다. 아래 순서를 그대로 수행하되 선행 결과가 없는 항목은 계약에 따른 단위 구현까지만 진행하고 실제 연결 완료를 별도 기록한다. 모든 완료 항목은 작업별 커밋과 MR 본문으로 끝낸다.

### D-01

**IN-01 · [FE] 카메라·마이크 분리 취득과 장치 수명**  
일정: D1 2026-09-08 · **오늘 1번**  
기획 근거: v0.0.8 **06, 20장**  
선행 완료 결과: 문서 내부 선행 없음; 외부 실행 전제는 F-01에서 확인

**수정·생성 파일**

- `apps/web/src/features/devices/device-manager.ts`
- `apps/web/src/features/devices/device-manager.test.ts`
- `apps/web/src/features/devices/device-status.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`

**구현 순서**

1. device-manager는 요청 중 Promise를 재사용해 카메라를 한 번만 취득한다. video width/height ideal 640/480, frameRate max30, audio:false로 요청하고 마이크는 별도 audio 요청으로 취득한다.
2. startDevices({microphone})의 사용자 제스처 초반 AudioContext 잠금 해제를 시작하고 camera/microphone/audioPlayback 상태를 [DeviceStatus](contracts/types.ts)로 보고한다. 초기 idle/off/locked, 취득 requesting, 성공 ready, 오류 failed/denied와 errorCode를 사용한다. 마이크 거부를 카메라 실패로 합치지 않는다.
3. getUserMedia의 늦은 성공은 요청 generation을 재검사해 폐기된 요청의 트랙을 stop한다. ended/devicechange/listener를 한 소유자로 관리하고 변경 성공 뒤 이전 장치 트랙을 정리한다.
4. InteractionRuntime.ts에 C가 사용할 facade와 export type을 작성하고 IN-01 단계에는 장치 메서드만 완성한다. 아직 없는 모델/Cloud 메서드를 성공 stub으로 반환하지 않고 후속 작업의 미구현 경계를 기록한다.
5. startDevices의 microphone 옵션 변경은 기존 camera Promise/track을 재사용한다. false는 기존 microphone 송신/track을 닫고 true는 마이크만 요청하며 이후 얼굴/보정 상태를 불필요하게 초기화하지 않는다.
6. 원본 camera stream을 읽는 로컬 HTMLVideoElement를 D가 한 번 생성해 muted/playsInline로 재생하고 onLocalPreview(element)를 호출한다. 장치 교체·종료에는 onLocalPreview(null)을 먼저 보낸 뒤 element.srcObject/listener·track을 D가 정리한다.

**연결 계약과 경계**

- createInteractionRuntime과 모든 callback/반환 타입은 [중앙 계약](contracts/types.ts)을 따른다. startDevices({microphone:boolean}):Promise<DeviceStatus>, calibrate():Promise<DeviceStatus>이며 endParticipation/dispose의 멱등 수명을 유지한다.
- 원본 camera는 devices 소유이며 가공 트랙과 다른 객체다. 장치 취득만으로 Cloud grant/게시를 시작하지 않는다.
- createInteractionRuntime 옵션에 onLocalPreview(element:HTMLVideoElement|null)를 제공한다. 이 element는 C의 장치 점검 화면 전용이며 processed-face 게시 handle이나 원격 onFaceTrack callback으로 재사용하지 않는다.

**시험 입력 → 기대 결과**

- 동시에 startDevices 두 번 → camera getUserMedia 1회와 동일 취득 상태.
- 카메라 허용·마이크 거부 → camera ready, microphone denied, 수신/보조 행동 가능 상태.
- 취득 중 dispose 후 권한 허용 → 뒤늦게 반환된 모든 track stop, ready callback 없음.
- 장치 교체 또는 dispose → onLocalPreview(null)이 element/track 정리 전에 발생하고 구 element가 새 장치의 preview를 덮지 않는다.

**추가·보완할 시험 파일**

- `apps/web/src/features/devices/device-manager.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/devices/device-manager.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

카메라와 마이크 권한을 따로 요청하고 웹캠 640×480·최대 30fps를 한 번만 취득한다. 마이크 거부가 카메라를 실패시키지 않으며 장치 변경·해제 시 트랙을 정리한다. Cloud는 연결하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 카메라와 마이크의 독립 장치 수명 구현
```

**MR 본문에 채울 변경 사항**

- 원본 장치 단일 취득과 권한 상태 분리
- 늦은 취득 응답·장치 변경·종료 정리

**MR 리뷰 포인트**

- 원본 영상이 게시 경로로 전달되지 않는지
- 선택 마이크와 카메라 준비 상태의 독립성

**완료 인계**

- C FL-02에 중앙 DeviceStatus와 onLocalPreview(element|null)의 초기·요청 중·성공·거절·폐기 호출 fixture를 전달한다. vision ready는 모델 로드·신선한 얼굴 검출·첫 안전 가공 프레임/살아있는 트랙을 모두 충족한 합성 상태이며 camera/calibration/audioPlayback과 별도다.
- F DP-01에 실제 대표 카메라/권한 거부/장치 분리 검증 조건을 전달.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/IN-01.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/IN-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-02

**IN-02 · [AI] 최신 프레임 한 개의 Worker 전송**  
일정: D1 2026-09-08 · **오늘 2번**  
기획 근거: v0.0.8 **15, 20장**  
선행 완료 결과: [D-01](d-vision-media.md#d-01) (IN-01, D1)

**수정·생성 파일**

- `apps/web/src/features/vision/vision.worker.ts`
- `apps/web/src/features/vision/worker-protocol.ts`
- `apps/web/src/features/vision/worker-scheduler.ts`
- `apps/web/src/features/vision/worker-scheduler.test.ts`
- `apps/web/src/features/vision/frame-pump.ts`
- `apps/web/src/features/vision/frame-pump.test.ts`
- `apps/web/tsconfig.worker.json`
- `apps/web/public/models/manifest.json`
- `apps/web/public/models/README.md`
- `apps/web/public/models/mediapipe/1.0.1/wasm/vision_wasm_internal.js`
- `apps/web/public/models/mediapipe/1.0.1/wasm/vision_wasm_internal.wasm`
- `apps/web/public/models/mediapipe/1.0.1/wasm/vision_wasm_module_internal.js`
- `apps/web/public/models/mediapipe/1.0.1/wasm/vision_wasm_module_internal.wasm`
- `apps/web/public/models/mediapipe/1.0.1/wasm/vision_wasm_nosimd_internal.js`
- `apps/web/public/models/mediapipe/1.0.1/wasm/vision_wasm_nosimd_internal.wasm`
- `apps/web/public/models/face/face_landmarker.task`
- `apps/web/public/models/pose/pose_landmarker.task`
- `apps/web/public/models/gesture/gesture_recognizer.task`

**구현 순서**

1. Vite new Worker(new URL("./vision.worker.ts",import.meta.url),{type:"module"}) 패턴으로 단일 Worker를 만든다. 입력마다 runtimeGeneration/frameId/sampledAtMs를 붙이고 Worker 요청·응답에서 그대로 유지한다. sampledAtMs는 메인 스레드 monotonic 성능 시계로 기록한 원본 프레임 관측 시각이며 모델 timestamp 인수도 이 값을 사용한다.
2. requestVideoFrameCallback 또는 확인된 대체 스케줄러에서 inFlight가 없을 때만 ImageBitmap을 전송한다. Worker 시계 값을 메인 시계와 직접 섞지 않는다. 응답 수신 시 메인에서 receivedAtMs를 기록하고 모델별 Sample에 원래 frameId/sampledAtMs와 valid/missing 결과를 붙인다. 실행하지 않은 모델의 sample은 변경하지 않으며 최초에는 null이다. 모든 bitmap의 처리/예외/dispose에서 close를 보장한다.
3. 설치된 tasks-vision 1.0.1의 FilesetResolver.forVisionTasks, VisionTaskOptions.canvas/VIDEO, TaskRunner.close 타입을 사용한다. 첫 모델 조합은 FaceLandmarker float16 release 1, PoseLandmarker Lite float16 release 1, GestureRecognizer float16 release 1로 고정한다. 아래 확인된 공식 URL에서 구현 시 취득하고 본문 작성 중에는 모델을 다운로드하지 않는다. 런타임은 외부 latest URL 대신 저장소의 고정 로컬 자산만 읽는다.
4. D의 tsconfig.worker.json은 WebWorker lib로 분리한다. F에게 main tsconfig Worker 제외·별도 검사·정적 MIME/CSP를 요청하며 다른 담당 설정을 직접 수정하지 않는다. 모델 로딩 실패는 오류를 보고하고 무한 재시도하지 않는다.
5. Face 모델은 [Face float16 release 1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) 에서 apps/web/public/models/face/face_landmarker.task로, Pose Lite는 [Pose Lite float16 release 1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) 에서 apps/web/public/models/pose/pose_landmarker.task로, Gesture는 [Gesture float16 release 1](https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task) 에서 apps/web/public/models/gesture/gesture_recognizer.task로 취득한다. generic 로컬 pose 파일명에도 manifest의 variant=pose_landmarker_lite, precision=float16, release=1을 보존한다.
6. 구현 시 취득한 각 모델과 복사한 WASM 파일에 Get-FileHash -Algorithm SHA256를 실행해 실제 sha256/bytes/sourceUrl/variant/release/acquiredAt를 manifest.json에 기록한다. 계획의 HEAD Content-Length나 URL만으로 SHA·라이선스를 만들지 않는다. 공식 모델 카드·배포 자산에서 확인한 license 및 licenseSource만 기록하며 미확인은 pending으로 남긴다. SDK 라이선스를 모델에 자동 전용하지 않는다.

**연결 계약과 경계**

- Worker 전달값은 센서 입력용 로컬 프레임뿐이며 게임/LiveKit 원본 게시 경로와 분리.
- F main tsconfig excludes **/*.worker.ts; D worker config는 vision.worker.ts 및 Worker 전용 import만 검사.
- 2026-09-07 읽기 전용 확인: 위 versioned 모델 URL 3개는 HEAD HTTP 200/application/octet-stream이다. Face 3,758,596 bytes, Pose Lite 5,777,746 bytes, Gesture 8,373,440 bytes였으며 모델 본문은 다운로드하지 않았다. 이 기록은 실제 모델 hash·라이선스·1.0.1 런타임 호환 검증을 대신하지 않는다.
- 공식 모델/variant 근거: [FaceLandmarker 모델 표](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker#models), [Pose Lite 모델 표](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker#models), [GestureRecognizer 모델 표](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer#models). 공식 표의 최신 링크를 런타임 URL로 쓰지 않고 위 HEAD 확인된 release 1을 취득한다.
- WASM은 현재 설치된 apps/web/node_modules/@mediapipe/tasks-vision/wasm에서 같은 1.0.1 파일을 apps/web/public/models/mediapipe/1.0.1/wasm으로 복사한다: vision_wasm_internal.js/.wasm, vision_wasm_module_internal.js/.wasm, vision_wasm_nosimd_internal.js/.wasm. resolver가 기대하는 원래 basename을 유지하며 모델 release 1과 SDK version 1.0.1을 혼동하지 않는다.

**시험 입력 → 기대 결과**

- 추론100ms 중 프레임3개 도착 → inFlight1, 추가 프레임 폐기, 대기 배열 증가 없음.
- 구 runtimeGeneration 결과/Worker exception → 센서 적용 없음, bitmap 해제와 상태 오류 1회.
- 얼굴만 실행된 새 프레임 → pose/gesture의 frameId와 sampledAtMs는 그대로, emittedAtMs만 새 값; 캐시를 새 관측으로 포장하지 않음.
- 새로 실행해 미검출 → 새 Sample의 status=missing/data=null; 미실행의 기존 Sample 유지와 구분.
- 메인/Worker timeOrigin이 다름 → sampledAtMs/receivedAtMs/emittedAtMs는 메인 시계 기준으로 일관됨.
- 모델 hash/MIME 불일치 또는 종료 중 모델 로드 완료 → 준비 불가, 생성된 모델 close와 Worker terminate.

**추가·보완할 시험 파일**

- `apps/web/src/features/vision/worker-scheduler.test.ts`
- `apps/web/src/features/vision/frame-pump.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/vision/worker-scheduler.test.ts apps/web/src/features/vision/frame-pump.test.ts
pnpm exec tsc -p apps/web/tsconfig.worker.json --noEmit
pnpm --filter @kkakkung/web build
pnpm typecheck
pnpm lint
```

**완료 조건**

Dedicated Worker 빌드·타입 검사를 추가하고 진행 중 프레임 외 대기 적체를 막는다. 오래된 결과·중단 후 응답을 폐기하고 프레임/Worker 종료를 검증한다. 모델·WASM은 버전 고정 자산으로 준비한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 최신 프레임 기반 비전 Worker 실행 구조 추가
```

**MR 본문에 채울 변경 사항**

- 단일 프레임 전송과 generation별 결과 격리
- 버전 고정 모델/WASM 자산과 별도 Worker 타입 검사

**MR 리뷰 포인트**

- 기다리는 프레임 적체·종료 후 응답·bitmap 누수
- 공식 자산 출처/hash와 Worker의 실제 브라우저 구동

**완료 인계**

- F에 vision.worker.ts와 tsconfig.worker.json의 정확한 include/exclude·검사 명령을 인계한다.
- C에는 onSensors가 좌우 정규화된 데이터만 내보내며 원본 프레임은 전달하지 않는다고 명시한다.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/IN-02.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/IN-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-03

**IN-03 · [AI] 얼굴 센서값 추론**  
일정: D1 2026-09-08 · **오늘 3번**  
기획 근거: v0.0.8 **15, 20장**  
선행 완료 결과: [D-02](d-vision-media.md#d-02) (IN-02, D1)

**수정·생성 파일**

- `apps/web/src/features/vision/face-sensor.ts`
- `apps/web/src/features/vision/face-sensor.test.ts`
- `apps/web/src/features/vision/vision.worker.ts`
- `apps/web/src/features/vision/sensor-types.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`

**구현 순서**

1. FaceLandmarker.createFromOptions에 runningMode:"VIDEO", numFaces:1, outputFacialTransformationMatrixes:true와 고정 modelAssetPath를 사용한다. detectForVideo(frame,sampledAtMs)에 프레임의 메인 monotonic 관측 시각을 전달하며 최대15fps 목표 주기로 호출한다.
2. faceLandmarks와 facialTransformationMatrixes에서 yaw/크롭용 점을 추출한다. 설치된 FaceLandmarkerResult에 별도 confidence 점수가 없으므로 score 필드를 만들어 읽지 말고 점 존재·finite·필수 점·시각 신선도·각도/크롭 유효성을 내부 품질 상태로 정의한다.
3. 화면 미러는 표시 좌표와 의미 방향의 변환을 한 helper에서 처리한다. 센서 결과에는 원본 프레임 대신 timestamp/정규화 landmarks/yaw/validity만 포함한다.
4. 얼굴 없음·급회전·오래된 결과를 명시적 invalid로 보내고 모델 종료 시 close한다. 대표 장치에서 얼굴 이탈과 좌우 회전을 확인하며15fps는 목표/실측으로 구분한다.

**연결 계약과 경계**

- D onSensors의 SensorSnapshot {runtimeGeneration,emittedAtMs,face,pose,gesture}를 C·입력·얼굴 가공에 공유한다. 각 센서는 중앙 Sample<T> 타입이며 생성한 관측 시각을 유지한다.
- SDK source: apps/web/node_modules/@mediapipe/tasks-vision/vision.d.ts FaceLandmarkerResult와 outputFacialTransformationMatrixes.
- [중앙 타입](contracts/types.ts)의 `Sample<T>`와 `FaceSensor`/`PoseSensor`/`GestureSensor` 및 `SensorSnapshot`을 제품 sensor-types.ts에 동일하게 구현하고 [공유 fixture](contracts/fixtures.ts)로 생산자·소비자를 검사한다. runtimeGeneration/emittedAtMs는 묶음, frameId/sampledAtMs/receivedAtMs/status/data는 센서별이다. valid data도 quality=uncertain이면 유효 자세/얼굴로 인정하지 않는다. 미실행은 이전 Sample 유지 또는 최초 null, 새 미검출은 missing/data=null이다. face/pose age>300ms, gesture age>400ms는 사용 불가이며 다른 센서 갱신으로 유효 시간을 연장하지 않는다. Pose visibility 누락은 0, 비유한 좌표는 missing 처리하고 SDK에 없는 presence/전체 얼굴 score는 읽지 않는다.
- 공식 동작 참고: [Face 웹 가이드](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js) . 웹 안내의 예제와 설치 버전의 함수 인수가 다르면 설치된 1.0.1 타입을 확인해 timestamp 인자를 명시한다.

**시험 입력 → 기대 결과**

- 정면 유효 landmarks+matrix → finite yaw와 얼굴 가공 가능한 validity 출력.
- faceLandmarks=[]/NaN → 새 missing Sample, 이동·크롭에서 얼굴로 사용하지 않음. sampledAtMs 기준 face age>300ms면 캐시가 있어도 사용 불가.
- face의 새 frameId만 반복 갱신 → pose/gesture의 관측 시각·hold를 연장하지 않음.
- 좌우 미러 변환 두 번 적용 시도 → 단일 helper 결과만 사용해 화면 좌/우 의미가 뒤집히지 않음.

**추가·보완할 시험 파일**

- `apps/web/src/features/vision/face-sensor.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/vision/face-sensor.test.ts
pnpm exec tsc -p apps/web/tsconfig.worker.json --noEmit
pnpm typecheck
pnpm lint
```

**완료 조건**

Face Landmarker에서 얼굴 랜드마크·방향·신뢰도를 얻고 15fps 목표로 스케줄한다. 얼굴 없음·급회전 결과를 명시하며 좌우 반전 해석을 UI와 맞춘다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 얼굴 방향과 안전 크롭 센서 추론 연결
```

**MR 본문에 채울 변경 사항**

- 15fps 목표 Face Landmarker 스케줄과 정규화
- 존재하지 않는 SDK confidence에 의존하지 않는 품질 판정

**MR 리뷰 포인트**

- 실제 SDK 출력 필드와 내부 validity의 구분
- 얼굴 이탈/급회전/미러 방향 검증

**완료 인계**

- C와 ME-01에 정규화 landmarks·미러 좌표·validity fixture를 제공한다.
- F QA-02에 추론 시간/누락 수/실효fps 수집 hook을 전달.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/IN-03.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/IN-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-04

**IN-04 · [AI] 상체·탈출 자세 추론**  
일정: D1 2026-09-08 · **오늘 4번**  
기획 근거: v0.0.8 **11, 15, 20장**  
선행 완료 결과: [D-02](d-vision-media.md#d-02) (IN-02, D1)

**수정·생성 파일**

- `apps/web/src/features/vision/pose-sensor.ts`
- `apps/web/src/features/vision/pose-sensor.test.ts`
- `apps/web/src/features/vision/vision.worker.ts`
- `apps/web/src/features/vision/sensor-types.ts`

**구현 순서**

1. PoseLandmarker.createFromOptions VIDEO 모드로 모델을 만들고 detectForVideo를10fps 목표로 스케줄한다. 모델3개를 같은 프레임에서 무조건 모두 호출하지 않고 문맥과 due 시각으로 분산한다.
2. 어깨·엉덩이·팔꿈치·손목 landmarks와 실제 visibility를 정규화한다. 설치 타입에 없는 presence/전체 confidence는 읽지 않는다. 상체 기울임은 몸통 축 기준으로 계산하고 부분 미검출을 불확실로 표시한다.
3. 미러 좌우 해석을 공통 helper로 정규화해 Sample<PoseSensor>로 C에 전달한다. 실제 새 pose 분석에만 frameId/sampledAtMs를 갱신하고 age>300ms 또는 missing은 사용할 수 없다. C EX-04가 새 pose 표본의 1.2초 유지를 소유하며 D는 성공 카운터나 EXIT_PROGRESS를 만들지 않는다.
4. 앉은 자세·한쪽 손 가림·급격한 조명 변화·중단 후 결과를 실제 장치와 합성 landmarks로 검사하고 모델/임시 결과의 close 수명을 지킨다.

**연결 계약과 경계**

- onSensors.pose는 C 포즈 평가와 D 이동 입력이 같이 소비하는 센서이며 신체 자세를 서버에 증명하는 정보가 아니다.
- SDK PoseLandmarker.detectForVideo 동기 반환 타입과 필요 자원 close를 설치된 vision.d.ts에서 확인.
- [중앙 타입](contracts/types.ts)의 `Sample<T>`와 `FaceSensor`/`PoseSensor`/`GestureSensor` 및 `SensorSnapshot`을 제품 sensor-types.ts에 동일하게 구현하고 [공유 fixture](contracts/fixtures.ts)로 생산자·소비자를 검사한다. runtimeGeneration/emittedAtMs는 묶음, frameId/sampledAtMs/receivedAtMs/status/data는 센서별이다. valid data도 quality=uncertain이면 유효 자세/얼굴로 인정하지 않는다. 미실행은 이전 Sample 유지 또는 최초 null, 새 미검출은 missing/data=null이다. face/pose age>300ms, gesture age>400ms는 사용 불가이며 다른 센서 갱신으로 유효 시간을 연장하지 않는다. Pose visibility 누락은 0, 비유한 좌표는 missing 처리하고 SDK에 없는 presence/전체 얼굴 score는 읽지 않는다.
- 공식 동작 참고: [Pose 웹 가이드](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js) . 실제 함수/출력 필드는 설치된 1.0.1 vision.d.ts를 기준으로 검증한다.

**시험 입력 → 기대 결과**

- 양 어깨/엉덩이 유효 → 중립 대비 전후 기울임 값 반환.
- 손목 하나 미검출 → 낮은 visibility 또는 missing을 전달하고 C hold가 초기화됨; 새 관측 없이 이전 pose를 재발행해 성공을 연장하지 않음.
- face만 갱신되고 pose Sample 정지 → age 301ms에서 pose 사용 불가, C 진행 초기화.
- challenge 시작/끝 또는 Worker 폐기 → 문맥별 주기만 변경, D에 포즈 성공/1.2초 별도 판정 없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/vision/pose-sensor.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/vision/pose-sensor.test.ts
pnpm exec tsc -p apps/web/tsconfig.worker.json --noEmit
pnpm typecheck
pnpm lint
```

**완료 조건**

Pose Landmarker 상체 랜드마크·신뢰도를 10fps 목표로 제공하고 포즈 문맥에 맞춰 추론한다. 앉은 자세와 신체 일부 미검출을 실제 장치로 확인한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 상체 기울임과 포즈 센서 추론 연결
```

**MR 본문에 채울 변경 사항**

- 상체 landmarks와 품질·미러 정규화
- 포즈 문맥을 반영한10fps 목표 스케줄

**MR 리뷰 포인트**

- C 포즈 도전과 D 센서 책임 중복 여부
- 부분 미검출·앉은 자세의 실제 검증

**완료 인계**

- C EX-04에 landmarks 인덱스/좌우 의미/품질 fixture를 고정해 전달한다.
- F QA-02와 C FL-02에 상체 보정용 가시 관절 조건 전달.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/IN-04.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/IN-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-05

**IN-05 · [AI] 손바닥·브이 제스처 추론**  
일정: D1 2026-09-08 · **오늘 5번**  
기획 근거: v0.0.8 **06, 15, 20장**  
선행 완료 결과: [D-02](d-vision-media.md#d-02) (IN-02, D1)

**수정·생성 파일**

- `apps/web/src/features/vision/gesture-sensor.ts`
- `apps/web/src/features/vision/gesture-sensor.test.ts`
- `apps/web/src/features/vision/vision.worker.ts`
- `apps/web/src/features/vision/sensor-types.ts`

**구현 순서**

1. GestureRecognizer.createFromOptions VIDEO와 recognizeForVideo(frame,sampledAtMs)를8fps 목표로 연결한다. 공식 모델의 Open_Palm/Victory categoryName을 확인하고 모델/label map 버전을 manifest와 묶는다.
2. 각 손의 유효 분류와 score를 읽는다. 손 없음·점수 미달은 none, 서로 다른 유효 palm/victory가 동시에 있으면 none으로 정규화한다. 같은 유효 종류가 여러 손에 있으면 최고 score의 단일 종류만 선택한다. 별도 HandLandmarker나 후보 배열을 추가하지 않는다.
3. Sample<GestureSensor>의 data는 단일 {kind,score}다. 다중 손 중재는 이 센서에서 끝내고 IN-09에는 한 종류만 전달한다. IN-09는 이 단일 결과에 600ms 유지와 현재 행동 문맥을 적용하며 센서가 명령을 직접 보내지 않는다.
4. 실제 분석한 sample의 sampledAtMs/frameId를 보존한다. 모델 교체·손 이탈·missing 및 age>400ms에는 hold가 남지 않게 none/사용 불가를 전달한다. 동일 sample을 새 유효 관측으로 연장하지 않는다.

**연결 계약과 경계**

- onSensors.gesture는 분류 센서이고600ms 유지와 명령은 IN-09 소유.
- Gesture 모델에 포함된 손 검출 경로를 사용하며 모델3개 상시 동시 추론을 피한다.
- [중앙 타입](contracts/types.ts)의 `Sample<T>`와 `FaceSensor`/`PoseSensor`/`GestureSensor` 및 `SensorSnapshot`을 제품 sensor-types.ts에 동일하게 구현하고 [공유 fixture](contracts/fixtures.ts)로 생산자·소비자를 검사한다. runtimeGeneration/emittedAtMs는 묶음, frameId/sampledAtMs/receivedAtMs/status/data는 센서별이다. valid data도 quality=uncertain이면 유효 자세/얼굴로 인정하지 않는다. 미실행은 이전 Sample 유지 또는 최초 null, 새 미검출은 missing/data=null이다. face/pose age>300ms, gesture age>400ms는 사용 불가이며 다른 센서 갱신으로 유효 시간을 연장하지 않는다. Pose visibility 누락은 0, 비유한 좌표는 missing 처리하고 SDK에 없는 presence/전체 얼굴 score는 읽지 않는다.
- 공식 동작 참고: [Gesture 웹 가이드](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/web_js) . 실제 모델의 categoryName과 고정 label map을 비교한다.

**시험 입력 → 기대 결과**

- Open_Palm 하나 또는 같은 종류 여러 손 → palm 한 개와 최고 유효 score, 센서의 command 전송 0회.
- 손 없음/낮은score/유효 프레임 간 공백 → none, 이전 hold 연장 없음.
- 양손 palm/victory 상충 → 단일 none, 후보 배열·명령 발생 없음; IN-09 hold 초기화.
- gesture Sample 정지, 얼굴만 새로 갱신 → age>400ms에서 hold 종료, 과거 손동작 재발동 없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/vision/gesture-sensor.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/vision/gesture-sensor.test.ts
pnpm exec tsc -p apps/web/tsconfig.worker.json --noEmit
pnpm typecheck
pnpm lint
```

**완료 조건**

Gesture Recognizer로 손바닥/브이를 8fps 목표로 구분한다. 별도 Hand 모델을 중복 실행하지 않고 손 없음·불확실 결과를 발동으로 취급하지 않는다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 손바닥과 브이 제스처 센서 연결
```

**MR 본문에 채울 변경 사항**

- Gesture Recognizer와 고정 label map 연결
- 불확실 손동작·복수 후보의 안전 전달

**MR 리뷰 포인트**

- 실제 categoryName/score와 모델 자산 버전
- 별도 Hand 모델·센서 단계의 직접 행동 실행 여부

**완료 인계**

- IN-09에 frameId/sampledAtMs가 포함된 palm/victory/none·양손 상충·동일 종류 최고 score fixture를 전달한다.
- F QA-02에 gesture 실효fps·미검출/오분류 계측 값을 제공.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/IN-05.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/IN-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-06

**IN-06 · [AI] 중립 보정과 센서 안정화**  
일정: D1 2026-09-08 · **오늘 6번**  
기획 근거: v0.0.8 **06, 15, 25장**  
선행 완료 결과: [D-03](d-vision-media.md#d-03) (IN-03, D1), [D-04](d-vision-media.md#d-04) (IN-04, D1)

**수정·생성 파일**

- `apps/web/src/features/input/calibration.ts`
- `apps/web/src/features/input/calibration.test.ts`
- `apps/web/src/features/input/one-euro-filter.ts`
- `apps/web/src/features/input/one-euro-filter.test.ts`
- `apps/web/src/features/input/input-tuning.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`

**구현 순서**

1. calibrate() 동안 안정된 얼굴/상체 표본만 수집해 사용자 중립 yaw/lean 기준을 정한다. 충분한 유효 표본이 없으면 미보정으로 남기고 이전 사용자나 장치의 기준을 재사용하지 않는다.
2. One Euro Filter는 샘플 dt를 이용한 미분 저역필터→적응 cutoff→값 저역필터 순서로 구현한다. dt<=0/긴 공백에는 안전 초기화를 하고 Infinity/NaN을 이후 단계로 흘리지 않는다.
3. 발동/해제 각도 임계값을 분리하고 중립150ms 안정구간을 유지한다. 전진180/후진320/회전150/중립150ms 및 각도·필터 설정을 inputTuningVersion으로 고정해 런타임 한 판 중 변경을 막는다.
4. DeviceStatus.calibration의 idle/running/ready/failed와 errorCode로 보정을 보고한다. 신선한 서로 다른 face/pose Sample만 보정에 포함하고 새 match/장치 변경/실패 때 보정·hold를 초기화한다. 사용자 얼굴 하나의 절대 각도를 제품 규칙으로 고정하지 않는다.

**연결 계약과 경계**

- 공통 행동 시간은 서버 move450/turn300ms이며 로컬 인식 지연 상수와 다른 값이다.
- C는 calibrate 호출·결과표시만 소유; 필터와 중립 보정은 D 단일 구현.

**시험 입력 → 기대 결과**

- 보정 전 큰 기울임 → 행동 미발동 및 calibration 미완료.
- 발동/해제 경계의 반복 노이즈 → hysteresis로 반복 명령 없음.
- dt0/장시간공백/다른장치 → finite 초기상태로 복귀, 구 중립/hold 자동 재사용 없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/input/calibration.test.ts`
- `apps/web/src/features/input/one-euro-filter.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/input/calibration.test.ts apps/web/src/features/input/one-euro-filter.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

사용자 중립값·One Euro Filter·발동/해제 임계값과 중립 150ms 안정 구간을 적용한다. 보정 전 발동을 막고 흔들림·경계 반복·중립 복귀를 검사하며 첫 수치는 tuningVersion으로 관리한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 중립 보정과 모션 센서 안정화 구현
```

**MR 본문에 채울 변경 사항**

- 사용자별 중립·One Euro Filter·hysteresis 연결
- 입력 첫 수치의 버전과 안정구간 관리

**MR 리뷰 포인트**

- 필터 dt/NaN 처리와 보정 우회 여부
- 게임 행동시간과 입력 인식시간의 혼동 여부

**완료 인계**

- C FL-02에 calibration 상태 전이·재보정 가능 조건을 전달한다.
- F에 실제 장치별 각도/인식 오류 결과를 넘기고 수치 튜닝 후 버전 기록을 요청한다.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/IN-06.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/IN-06.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-07

**ME-01 · [FE] 흑백 얼굴 마스크·가공 스트림 생성**  
일정: D1 2026-09-08 · **오늘 7번**  
기획 근거: v0.0.8 **20장**  
선행 완료 결과: [D-01](d-vision-media.md#d-01) (IN-01, D1), [D-03](d-vision-media.md#d-03) (IN-03, D1)

**수정·생성 파일**

- `apps/web/src/features/media/face-compositor.ts`
- `apps/web/src/features/media/face-mask.ts`
- `apps/web/src/features/media/face-mask.test.ts`
- `apps/web/src/features/media/face-compositor.test.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`

**구현 순서**

1. 일반 HTMLCanvasElement160×160을 만들고 draw마다 전체를 검정으로 채운다. 얼굴 landmarks의 보수적 내부 마스크를 계산해 얼굴 경계 밖 원본 픽셀이 남지 않게 clip한다.
2. 마스크 안만 crop/scale하고 흑백으로 변환한다. 원본 camera video는 로컬 devices 참조로만 읽고 output stream은 이 Canvas.captureStream(10)에서만 만든다. OffscreenCanvas에서 captureStream을 호출하지 않는다.
3. 출력 트랙을 branded processed-face handle로 보관해 ME-04가 원본을 잘못 게시할 수 없게 한다. 현재 face Sample이 신선하고 첫 안전 가공 프레임과 살아있는 출력 트랙·모델 준비가 모두 확인돼야 DeviceStatus.vision을 ready로 보고한다. 가공 출력 생존 여부는 내부에서 추적하고 별도 공개 processedFace 필드를 만들지 않는다.
4. 합성 배경색/얼굴 윤곽을 사용한 pixel 검사와 실제 장치의 배경·머리회전 검사를 분리한다. 실제 얼굴 프레임을 파일/테스트 산출물에 저장하지 않고 육안 결과·합성 마스크 증거만 남긴다.

**연결 계약과 경계**

- 160×160/10fps 가공은 D; LiveKit 인코딩100kbps는 ME-04 소유.
- 원본/가공 MediaStreamTrack은 별도 객체. Canvas가 게시 가능한 유일한 영상 source다.

**시험 입력 → 기대 결과**

- 밝은 배경+작은 얼굴 fixture → 마스크 외 픽셀은 모두검정.
- 실수로 raw track을 compositor output으로 전달 → 타입/런타임 handle 검사에서 거절.
- 첫 얼굴 검출 전/기본 얼굴만 있음 또는 캔버스 실패 → vision ready 아님, raw 대체 없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/media/face-mask.test.ts`
- `apps/web/src/features/media/face-compositor.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/media/face-mask.test.ts apps/web/src/features/media/face-compositor.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

축소한 얼굴 마스크 밖을 검정으로 채워 160×160/10fps Canvas captureStream을 만든다. 배경·raw webcam track이 출력되지 않는 프레임 검사를 한다. 게시 인코딩 설정과 실측은 ME-04가 담당한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 배경을 차단한 흑백 얼굴 스트림 생성
```

**MR 본문에 채울 변경 사항**

- 랜드마크 내부 마스크와 Canvas 가공 트랙
- 원본 게시 방지 handle과 첫 안전프레임 준비 상태

**MR 리뷰 포인트**

- 사각crop만으로 배경제거를 완료 처리하지 않았는지
- 실제 얼굴 저장없이 남긴 합성/장치 검증 증거

**완료 인계**

- C FL-02에는 합성 준비 상태 DeviceStatus.vision을 제공한다. 원본 로컬 점검 미리보기는 IN-01의 onLocalPreview만 사용하고, 안전 가공 output handle은 D 내부 게시 경로가 소유한다.
- F QA-02에 가공fps/프레임비용, ME-04에 processed track handle을 전달.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/ME-01.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/ME-01.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-08

**ME-02 · [FE] 얼굴 추적 실패의 안전 프레임 전환**  
일정: D1 2026-09-08 · **오늘 8번**  
기획 근거: v0.0.8 **20, 24장**  
선행 완료 결과: [D-07](d-vision-media.md#d-07) (ME-01, D1)

**수정·생성 파일**

- `apps/web/src/features/media/safe-face.ts`
- `apps/web/src/features/media/safe-face.test.ts`
- `apps/web/src/features/media/face-compositor.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`

**구현 순서**

1. 얼굴 validity가 떨어지거나 결과가 오래되면 새 원본 프레임을 compositor에 그리지 않는다. 마지막 안전 Canvas 프레임을 보관해 잠시 유지한 뒤 코드로 생성한 기본 얼굴로 바꾼다.
2. 안전 프레임 유지시간은 기획서 확정 상수가 아니므로 safeFaceHoldMs를 명시적 초깃값으로 기록하고 장치검증 후 조정한다. 무기한 마지막 실사 얼굴 유지나 raw 영상 fallback은 금지한다.
3. 재검출은 현재 runtimeGeneration의 연속 안전 face Sample과 sampledAtMs 신선도를 확인해 복귀한다. 오래된 결과는 기본 얼굴을 덮지 못하며 age>300ms는 새 검출로 취급하지 않는다. 출력 Canvas 트랙 수는 그대로 유지한다.
4. 장치/추론 장애를 DeviceStatus로 보고하되 여기서 endParticipation을 호출하지 않는다. IN-10이 보조 입력을 전환하고 다음라운드 준비를 다시 검사하도록 한다.

**연결 계약과 경계**

- 카메라 장애는 참가 종료가 아니다. 안전 가공 source가 살아 있어도 필수 얼굴 점검이 실패하면 DeviceStatus.vision은 ready가 아니며 다음 라운드 준비를 통과시키지 않는다.
- 정확한 SDK confidence가 없는 얼굴은 IN-03 validity 신호를 사용.

**시험 입력 → 기대 결과**

- 급회전/얼굴이탈 → 마지막안전프레임 후 기본얼굴, raw배경 출력0.
- 기본얼굴 중 구Worker 정상응답 → 복귀하지 않고 현재generation의 안전응답만 수용.
- 장애↔복구 반복 → 출력track 개수1, 카메라장애만으로 게임Room 종료없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/media/safe-face.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/media/safe-face.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

얼굴 이탈·급회전·신뢰도 저하 시 마지막 안전 프레임 후 기본 얼굴로 전환한다. raw 대체와 배경 노출이 없으며 복구·반복 실패를 검사한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 얼굴 추적 장애의 안전 프레임 전환
```

**MR 본문에 채울 변경 사항**

- 마지막 안전프레임과 기본얼굴 fallback
- 복구 신뢰조건과 참가 종료 분리

**MR 리뷰 포인트**

- 유지시간을 검증된 기획값으로 잘못 표기하지 않았는지
- raw 대체·과거결과에 따른 안전프레임 오염 여부

**완료 인계**

- C/D IN-10에 camera/vision 실패와 안전 가공 출력이 살아 있는 경우의 중앙 DeviceStatus fixture를 전달한다.
- F에 이탈·급회전·반복복구의 합성픽셀/실제장치 검수 시나리오 전달.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/ME-02.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/ME-02.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-09

**IN-07 · [FE] 전후진 모션·키보드 의도 통합**  
일정: D1 2026-09-08 · **오늘 9번**  
기획 근거: v0.0.8 **06, 07장**  
선행 완료 결과: [D-06](d-vision-media.md#d-06) (IN-06, D1), [A-11](a-game-core.md#a-11) (RL-03, D1)

**수정·생성 파일**

- `apps/web/src/features/input/move-intent.ts`
- `apps/web/src/features/input/move-intent.test.ts`
- `apps/web/src/features/input/team-controller.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`

**구현 순서**

1. 제품 모션은 보정 lean의 전진180ms/후진320ms 연속 유지 후 forward/back 의도를 만든다. W/S·위/아래키는 같은 의도 함수로 보내고 양방향 동시입력은 neutral로 정한다.
2. active 문맥의 이동 유지 중100ms마다 MOVE_INTENT를 갱신한다. release/문맥종료에는 direction:null을 한 번 보내고 timer를 끊는다. 기존 team-controller의150ms move 반복은 명시적인 legacy 경로만 남긴다.
3. command envelope는 C sender가 부여하므로 D가 별도 sequence/requestId를 증가시키지 않는다. 서버450ms 행동/버퍼1/TTL500ms를 기다리며 웹에서 셀을 직접 움직이지 않는다.
4. blur/hidden/장치폴백/pose/개인종료에 held와 시작시각을 비운다. C setContext가 잠금·새match를 알리면 구모션을 재발동하지 않는다.

**연결 계약과 경계**

- MOVE_INTENT {direction:"forward"|"back"|null}, 유지10Hz; 게임 명령 protocol0.2.0만 사용.
- 기존 sandbox 벡터컨트롤러는 진단계약 그대로 보존; 키보드와모션의 최대속도는 서버가 제한.
- setContext.pageActive:boolean은 실제 phase/status를 바꾸지 않고 탭 숨김 입력을 잠근다. false에서 held/timer를 지우고 true에서도 새 키 입력·중립 모션부터 받는다.
- 이동에 사용하는 face/pose Sample은 서로 다른 새 frameId만 수용하고 각 age≤300ms를 요구한다. 과거 Sample을 담은 다른 센서 callback은 이동 유지의 새 관측이 아니다.

**시험 입력 → 기대 결과**

- forward179ms/180ms → 전자는없고후자부터forward갱신.
- 키유지 후 release/hidden → null1회와timer정지, 뒤늦은timer가이동전송안함.
- W와S동시 또는pose문맥 → neutral,서버상태/캐릭터위치 로컬변경없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/input/move-intent.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/input/move-intent.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

기울임 전진 180ms/후진 320ms와 W/S·위/아래 키가 동일한 서버 의도를 전송한다. 10Hz 유지 갱신 중단 시 다음 행동이 멈추며 입력 방식별 최대 속도가 같음을 검사한다. 첫 수치는 버전 고정한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 모션과 키보드 전후진 의도 통합
```

**MR 본문에 채울 변경 사항**

- 전후진 유지 인식과10Hz 제품 의도 전송
- 방식 전환·탭 상태·문맥 종료 입력 정리

**MR 리뷰 포인트**

- 중복 sender·legacy seq와제품sequence 혼용 여부
- 모션/키보드 실제 서버 최대속도와TTL 종료

**완료 인계**

- C에 setContext의 잠금전이 및 새match 리셋 요구를 전달한다.
- B RL-03에 direction:null과의도갱신중단의 실제Room fixture를 공유.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/IN-07.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/IN-07.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-10

**IN-08 · [FE] 회전 모션·키 해제 발동**  
일정: D1 2026-09-08 · **오늘 10번**  
기획 근거: v0.0.8 **06, 07장**  
선행 완료 결과: [D-06](d-vision-media.md#d-06) (IN-06, D1), [A-10](a-game-core.md#a-10) (RL-02, D1)

**수정·생성 파일**

- `apps/web/src/features/input/turn-intent.ts`
- `apps/web/src/features/input/turn-intent.test.ts`
- `apps/web/src/features/input/team-controller.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`

**구현 순서**

1. 보정 yaw가 좌·우 임계값을 150ms 유지하면 TURN을 한 번 내고 latch를 잠근다. 해제 임계값 안에서 중립 150ms를 유지하기 전에는 새 회전을 만들지 않는다.
2. A/D·좌/우 키는 첫 keydown에 한 번 보내고 event.repeat는 무시한다. keyup은 재발동을 허용하는 조건이며 키를 놓을 때 처음 회전하는 방식이 아니다.
3. 모션·키보드가 동시에 회전을 만들면 현재 mode의 후보만 채택한다. 서버의 6Tick 행동·다음 행동 1개 버퍼를 따르고 웹에 무한 행동 큐를 만들지 않는다.
4. 새 match·pose·개인 종료·pageActive=false·모드 변경에는 latch/hold를 비운다. 복귀 시 새로운 press 또는 중립 확인부터 다시 받는다.

**연결 계약과 경계**

- TURN {direction:"left"|"right"}는 C 공통 sender로 전송, 서버 turn300ms와 로컬150ms인식시간은 별개.
- 모션/키보드 이벤트 리스너는 D 단일 소유, C는 setContext만 조립한다. yaw Sample은 현재 runtimeGeneration·새 frameId·age≤300ms를 확인하고 stale이면 회전 latch를 지운다.
- setContext.pageActive:boolean은 실제 phase/status를 바꾸지 않고 탭 숨김의 입력을 잠근다. false에서 held/timer를 지우고 true에서도 새 키 입력·중립 모션부터 받는다.

**시험 입력 → 기대 결과**

- yaw150ms 유지후1초계속 → TURN1개; 중립149ms에는 재발동불가.
- keydown(repeat:false) 후repeat10개 → TURN1개; keyup뒤새keydown이면 다음1개.
- pose진입 또는모드전환 중 latched → 이전회전의늦은타이머 명령없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/input/turn-intent.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/input/turn-intent.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

고개 회전 150ms 유지와 중립 150ms 복귀, A/D·좌/우 키 해제를 발동/재발동 조건으로 사용한다. 키 자동 반복·고개 유지로 연속 발동하지 않으며 첫 수치는 버전 고정한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 중립 복귀 기반 단발 회전 입력 구현
```

**MR 본문에 채울 변경 사항**

- 고개 유지·중립 재무장과 키 반복 억제
- 문맥 전환의 회전 latch 정리

**MR 리뷰 포인트**

- 키해제가 첫발동이 아닌 재발동조건으로 처리되는지
- 모션·키보드 중복과 구프레임 회전 방지

**완료 인계**

- C FL-10에 hidden/visible 문맥변경 시 강제 held 초기화 경로를 전달한다.
- B RL-02와 F에 연타·중립미복귀·자동반복 실제 이동시간 검사 인계.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/IN-08.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/IN-08.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-11

**IN-09 · [FE] 손동작·단축키의 행동 문맥 중재**  
일정: D1 2026-09-08 · **오늘 11번**  
기획 근거: v0.0.8 **06, 09, 11, 13장**  
선행 완료 결과: [D-05](d-vision-media.md#d-05) (IN-05, D1), [B-02](b-game-server.md#b-02) (SV-02, D1)

**수정·생성 파일**

- `apps/web/src/features/input/interaction-context.ts`
- `apps/web/src/features/input/interaction-context.test.ts`
- `apps/web/src/features/input/gesture-intent.ts`
- `apps/web/src/features/input/gesture-intent.test.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`

**구현 순서**

1. 중앙 InteractionContext의 matchId/selfPlayerId/phase/status/role, targetPlayerId, incomingExchangeId/outgoingExchangeId, challengeId/exitId, selectedEquipment/installationId, mode/pageActive를 보관한다. 갱신에서 사라진 ID나 교환 방향이 바뀌면 기존 pending hold를 폐기한다. 제품 결정 대기의 아이템 상태·슬롯·사용 명령은 추가하지 않는다.
2. 단일 gesture Sample의 새 frameId를 기준으로 600ms를 유지하고 missing/none·age>400ms·관측 공백이면 hold를 초기화한다. incomingExchangeId가 있을 때만 palm/E를 EXCHANGE_ACCEPT로 보낸다. outgoing 상태는 대기·취소이며 자기 요청을 수락하지 않는다. E는 incoming 수락을 우선하고, 없으면 유효 exitId의 출구 상호작용, 그마저 없고 교환 세션도 없으면 targetPlayerId의 교환 요청으로 처리한다. 손바닥은 출구 시작에 사용하지 않고 교환 요청·수락에만 사용한다.
3. role=tagger일 때만 1/2 선택·브이/F를 허용하고 선택한 sensor/trap INSTALL을 만든다. role=null 또는 runner에는 선택과 설치 명령을 만들지 않는다. 취소는 INSTALL_CANCEL {installationId}로 보낸다. 1/2 선택은 onInteractionState({selectedEquipment,mode})로 C에 알린다. 도망자의 F에는 제품 행동을 배정하지 않는다. 같은 값 echo는 no-op이며 새 아이템 명령이나 kind enum을 만들지 않는다.
4. challenge 중에는 취소 외 일반 이동·회전·교환·장비를 막는다. C 키 폴백과 방향키 명령 중복을 차단하고 손 유지 중 반복 발동하지 않는다.
5. C가 주입한 sendCommand(CommandInput)만 호출하고 반환된 requestId:string을 요청 식별자로 보관한다. envelope의 matchId/sequence/requestId 생성과 전송은 C가 소유한다. 반환값을 envelope나 접수/실행 성공으로 해석하지 않고 대상 ID·거리·성공을 추측하지 않는다.

**연결 계약과 경계**

- EXEC-CONTRACT-2 setContext의 확정 필드와 strict 제품 payload 사용.
- onInteractionState 선택상태 callback은 C UI↔D 키보드 선택의 단일동기화 경로로 사용; 서버 권위상태 변경 callback이 아님.
- setContext.pageActive:boolean은 실제 phase/status를 바꾸지 않고 탭 숨김의 입력을 잠근다. false에서 held/timer를 지우고 true에서도 새 키 입력·중립 모션부터 받는다.
- EXIT_START의 키보드/E 경로는 D, 화면 시작 버튼은 C이며 둘 다 C 공통 sender의 matchId+exitId pending guard를 통과한다. D는 EXIT_PROGRESS를 생성하지 않고 C challenge-controller가 pose/keys 완료를 단독 소유한다.

**시험 입력 → 기대 결과**

- incomingExchangeId와 exitId가 동시 유효 + E → EXCHANGE_ACCEPT 1개, EXIT_START 0개. outgoingExchangeId만 있음 + E → 자기 요청 수락 0개.
- 손바닥599/600ms 및손이탈 → 경계에서1개만,이탈후hold초기화.
- 포즈 중 F/브이/방향키 → 금지 명령 0개; 취소의 현재 challengeId만 허용. 도망자 F는 제품 명령 0개.
- incoming→outgoing 전환 또는 exchange 삭제 중 palm 유지 → 과거 수락 hold 폐기, 새 사용자 입력 전까지 수락 없음.
- C 버튼 setContext와 D 키 onInteractionState가 같은 선택을 echo → 동일값은 no-op, callback 재귀/무한 렌더 없음.
- D 센서가 포즈 유지 완료처럼 보이거나 키 시퀀스가 끝남 → D의 EXIT_PROGRESS 전송 0회, 완료는 C 컨트롤러에만 귀속.
- sendCommand가 UUID 문자열 반환 → 해당 requestId만 보관, D의 별도 envelope/sequence 생성·성공 확정 없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/input/interaction-context.test.ts`
- `apps/web/src/features/input/gesture-intent.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/input/interaction-context.test.ts apps/web/src/features/input/gesture-intent.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

손바닥/브이 0.6초 유지, E/F·버튼·1/2 선택을 행동 의도로 변환한다. E는 교환 수락 우선, 포즈 수행 중 다른 행동 차단, 같은 프레임 중복 해석 방지를 검사한다. 각 실제 UI는 기능별 작업에서 연결한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 제스처와 단축키의 행동 문맥 통합
```

**MR 본문에 채울 변경 사항**

- 교환·술래 장비·출구 문맥의 단일 행동 선택
- 선택상태 UI동기화와 stale 대상ID 폐기

**MR 리뷰 포인트**

- incoming/outgoing 방향·E 우선순위·포즈 잠금·미정 콘텐츠 실행 방지
- command envelope의중복생성과같은프레임중복발동

**완료 인계**

- C EQ/KN/EX 화면에 setContext/onInteractionState 필드와 우선순위표를 전달한다.
- C/B에 CommandInput→requestId 문자열 반환과 INSTALL/INSTALL_CANCEL·교환 방향 fixture를 전달한다. D는 반환 requestId로 요청을 식별하고 종결은 C의 command-result/command-outcome/상태 조회 경로가 처리한다.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/IN-09.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/IN-09.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-12

**IN-10 · [FE] 카메라·추론 장애의 입력 폴백**  
일정: D1 2026-09-08 · **오늘 12번**  
기획 근거: v0.0.8 **06, 20, 24장**  
선행 완료 결과: [D-09](d-vision-media.md#d-09) (IN-07, D1), [D-10](d-vision-media.md#d-10) (IN-08, D1), [D-11](d-vision-media.md#d-11) (IN-09, D1), [D-08](d-vision-media.md#d-08) (ME-02, D1)

**수정·생성 파일**

- `apps/web/src/features/input/input-fallback.ts`
- `apps/web/src/features/input/input-fallback.test.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`
- `apps/web/src/features/input/interaction-context.ts`

**구현 순서**

1. camera ended·Worker error·추론 미응답·얼굴 invalid로 입력 장애를 감지한다. 이동 timer·회전 latch·gesture hold·모션 버퍼를 비운 뒤 keyboard mode로 전환한다.
2. ME-02의 안전 얼굴을 유지하고 장치·비전 문제를 상태 callback으로 보낸다. 게임 참가·Room·미디어 세대를 전체 종료하지 않는다.
3. 새 키누름부터 보조 입력을 받으며 장애 직전 held를 다시 적용하지 않는다. 복구 뒤에도 새 보정·명시적 mode 선택으로 모션을 다시 활성화한다.
4. 현재 판은 유지하고 다음 라운드에는 C가 필수 카메라·보정을 다시 검사하게 한다. 마이크만 장애인 경우 모션은 유지하고 ME-04 송신만 중단한다.

**연결 계약과 경계**

- 카메라/추론 장애와 게임 권위 상실은 다름; endParticipation 호출금지.
- D 센서/입력/가공얼굴 수명만 전환하며 C는 표시·다음준비 gating을 조립.

**시험 입력 → 기대 결과**

- 전진hold중카메라ended → null1회+bufferclear,새W입력전까지 이동명령없음.
- 카메라장애→복구응답지연 → 게임계속/안전얼굴,과거모션재발동없음.
- 마이크만거부/ended → 모션입력유지; 다음라운드카메라미복구 → READY불가.

**추가·보완할 시험 파일**

- `apps/web/src/features/input/input-fallback.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/input/input-fallback.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

모션 상태·대기 입력을 비우고 키보드와 안전 얼굴로 전환해 경기를 유지한다. 다음 라운드 준비에는 카메라 복구를 요구하며 갑작스러운 이동·자동 재발동이 없다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 카메라 장애의 안전 입력 폴백 연결
```

**MR 본문에 채울 변경 사항**

- 모션 버퍼 정리와 키보드 전환
- 안전 얼굴·현재 경기 유지·다음 준비 복구 요구

**MR 리뷰 포인트**

- 참가 종료나새미디어세대가불필요하게발생하는지
- 장치복구의급발진과마이크장애오분류

**완료 인계**

- C FL-02/EX-05/FL-09에 fallback 상태와 새라운드 보정 요구를 인계한다.
- F QA-09에 모션중카메라해제→키보드완주→재준비 시나리오 제공.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/IN-10.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/IN-10.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-13

**ME-03 · [FE] 승인된 미디어 세대 연결**  
일정: D2 2026-09-09 · **오늘 1번**  
기획 근거: v0.0.8 **05, 18, 19, 22장**  
선행 완료 결과: [E-05](e-media-operations.md#e-05) (MC-02, D1)

**수정·생성 파일**

- `apps/web/src/features/media/media-session.ts`
- `apps/web/src/features/media/media-session.test.ts`
- `apps/web/src/features/media/media-types.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`

**구현 순서**

1. C의 requestMediaGrant 결과를 중앙 MediaGrant 타입과 현재 matchId/mediaInstanceId/receiverGeneration에 대조한다. 승인 URL/token/roomName/mediaIdentity를 그대로 사용하고 토큰은 메모리에만 둔다. 수신자 자신의 연결 세대와 원격 publisherGeneration을 섞지 않는다.
2. SDK Room 생성·이벤트 등록·connect(url,token,{autoSubscribe:false})를 세대별 Promise 하나로 직렬화한다. 늦은 성공은 terminal/현재 세대를 재검사한 뒤 정리한다.
3. LOBBY/DEVICE_CHECK에서는 연결하지 않는다. 연습·경기 준비의 승인 grant만 허용하고 같은 참가자의 전체 Room 연결 두 개가 동시에 살아 있지 않게 한다.
4. RoomEvent Connected/Reconnecting/SignalReconnecting/Reconnected/Disconnected를 [MediaStatus](contracts/types.ts)의 connecting/connected/recovering/closed/failed 상태와 해당 matchId/mediaInstanceId/receiverGeneration으로 정규화해 보고한다. connected는 SDK 연결 성공일 뿐 서버 권한·바인딩 준비 완료가 아니다. grant 발급 성공 또한 게시 성공이 아니며 B가 확인한 자기 faceTrackSid와 준비 장벽을 별도로 기다린다.

**연결 계약과 경계**

- livekit-client2.22.2 Room.connect의RoomConnectOptions.autoSubscribe 확인; false는접근권한강제완료가아님.
- MediaGrant/Bearer보고함수는C주입; E강제권한MC-01실제검증실패시면제품연결완료불가.

**시험 입력 → 기대 결과**

- 같은 grant로 중복 connect → Room/connect 1개, 중복 publisher 없음.
- 한 사람만 전체 재연결 → 해당 사람의 receiverGeneration/Identity만 새 값, 나머지 다섯 연결 유지; 원격 publisherGeneration은 각 참가자별로 갱신.
- LOBBY/expired/구matchgrant → connect호출0,안전오류상태.
- connect중retire후SDK성공 → 즉시disconnect,ready보고·게시없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/media/media-session.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/media/media-session.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

서버가 승인한 Room·Identity·generation만 사용해 autoSubscribe=false로 연결한다. 로비·장치 확인에서는 미연결이고 동일 참가자의 중복 전체 연결을 막는다. 연결 실패를 준비 실패로 보고한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 승인된 미디어 세대의 클라이언트 연결
```

**MR 본문에 채울 변경 사항**

- 서버 grant와 단일 SDK연결 수명 결합
- 늦은연결·금지phase·복구상태 보고

**MR 리뷰 포인트**

- autoSubscribe=false를SFU접근통제로과장하지않는지
- 토큰메모리보관과중복Room연결방지

**완료 인계**

- C SessionRuntime에 connectMedia(grant)/onMediaStatus와보고오류코드를넘긴다.
- E MC-08의10초창과구세대회수후새grant상태를B통해받고FCloudprobe와별도제품통합을검사.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/ME-03.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/ME-03.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-14

**ME-04 · [FE] 가공 얼굴·선택 마이크 게시**  
일정: D2 2026-09-09 · **오늘 2번**  
기획 근거: v0.0.8 **06, 19, 20장**  
선행 완료 결과: [D-13](d-vision-media.md#d-13) (ME-03, D2), [D-07](d-vision-media.md#d-07) (ME-01, D1), [D-01](d-vision-media.md#d-01) (IN-01, D1), [E-09](e-media-operations.md#e-09) (MC-06, D2)

**수정·생성 파일**

- `apps/web/src/features/media/track-publisher.ts`
- `apps/web/src/features/media/track-publisher.test.ts`
- `apps/web/src/features/media/media-session.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`

**구현 순서**

1. ME-01의 processed-face handle과 선택 마이크만 게시한다. publishTrack의 설치 타입에 맞춰 source:Camera, videoEncoding:{maxBitrate:100000,maxFramerate:10}, simulcast:false를 적용하고 원본 카메라·화면공유는 거절한다.
2. 얼굴·마이크 각 한 publication을 현재 mediaInstanceId/receiverGeneration과 함께 추적한다. LocalTrackPublished 성공은 서버 권한 승인이 아니며 B media-bindings의 자기 publisherGeneration·Identity·SID 검증을 기다린다.
3. microphone:false 또는 마이크 ended에는 해당 송출만 즉시 중지한다. 새 SID로 재게시는 이전 publication을 정리하고 B/E 검증 바인딩을 기다린다. 같은 publication/SID의 replaceTrack은 소스만 바꾸고 기존 권한을 유지하며 새 게시 사건을 요구하지 않는다. 두 경로 모두 얼굴·수신·게임 연결을 불필요하게 종료하지 않는다.
4. outbound bytesSent의 시간 차로 얼굴 bitrate를 측정한다. 100kbps 설정 목표와 오버헤드를 포함한 실측을 구분하고 실패 시 원본 트랙으로 대체하지 않는다.

**연결 계약과 경계**

- SDK2.22.2 LocalParticipant.publishTrack(MediaStreamTrack,TrackPublishOptions), unpublishTrack(track,stopOnUnpublish?)와VideoEncoding필드를설치소스로확인.
- 새 SID 게시와 같은 publication/SID의 replaceTrack은 구분한다. 새 SID는 기본 차단·바인딩 검증 후 허용하고, 같은 SID 소스 교체는 기존 권한과 불허 수신자 차단의 유지·새 프레임 수신을 검사한다. 새 webhook/SID가 반드시 생긴다고 가정하지 않는다.

**시험 입력 → 기대 결과**

- processed얼굴+mic허용 → 각1개만게시,rawcamera와screen추가시거절.
- 마이크off/장애 → audio송신중지,remoteaudio·얼굴·게임Room유지.
- low전환/재게시후새SID → B대조전허용상태미보고,구publication작업이새track을stop하지않음.
- 같은 SID의 replaceTrack → 기존 허용자는 새 프레임 수신, 불허 수신자는 계속 차단; 새 webhook/SID를 기다리며 멈추지 않음.
- SDKpublish성공이나권한검증실패 → 준비완료보고없음,안전정리.

**추가·보완할 시험 파일**

- `apps/web/src/features/media/track-publisher.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/media/track-publisher.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

가공 얼굴 1트랙과 선택 마이크 1트랙만 게시하고 얼굴 인코딩 목표 100kbps를 설정·실측한다. mute/마이크 장애는 송신만 중지한다. 새 SID 게시의 검증 장벽, 같은 SID 소스 교체의 기존 권한 유지, 전체 세대 교체의 회수 경계를 구분해 확인한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 가공 얼굴과 선택 마이크 게시 연결
```

**MR 본문에 채울 변경 사항**

- 게시영상source제한과100kbps목표인코딩
- 마이크중단·재게시·source교체의검증경로

**MR 리뷰 포인트**

- 화면공유/원본영상우회게시방지
- 실제bitrate와설정상한·SDK성공과정책승인구분

**완료 인계**

- E/B MC-06에publicationSID/source변경fixture를주고확인된binding만소비한다.
- C VI-05 setQualityPreset에따른저해상도전환과F통계의trackSid리셋기준을전달.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/ME-04.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/ME-04.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-15

**ME-05 · [FE] 허용 얼굴 트랙 수신·교체**  
일정: D2 2026-09-09 · **오늘 3번**  
기획 근거: v0.0.8 **08, 19.3, 20장**  
선행 완료 결과: [D-13](d-vision-media.md#d-13) (ME-03, D2), [E-09](e-media-operations.md#e-09) (MC-06, D2)

**수정·생성 파일**

- `apps/web/src/features/media/remote-faces.ts`
- `apps/web/src/features/media/remote-faces.test.ts`
- `apps/web/src/features/media/media-bindings.ts`
- `apps/web/src/features/media/media-bindings.test.ts`
- `apps/web/src/features/media/pending-tracks.ts`
- `apps/web/src/features/media/pending-tracks.test.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`

**구현 순서**

1. media-bindings의 matchId/mediaInstanceId/receiverGeneration/bindingRevision을 검사하고 현재 수신자 세대에서 더 큰 revision의 전체 목록만 적용한다. 각 player의 publisherGeneration/mediaIdentity/participantSid/faceTrackSid를 독립 대조한다. 자기 entry는 게시 검증용으로만 읽고 자기 publisherGeneration=receiverGeneration을 확인하며 원격 attach/play/onFaceTrack을 만들지 않는다. 이름·attributes로 매핑하지 않는다.
2. 트랙 레지스트리와 검증 바인딩을 따로 보관하고 TrackSubscribed·바인딩 도착/교체·구독 해제마다 reconcile한다. 둘이 일치할 때만 muted/playsInline video를 attach하고 onFaceTrack({matchId,playerId,mediaInstanceId,receiverGeneration,publisherGeneration,trackSid,element})을 보낸다. 바인딩이 나중에 오면 이미 받은 publication/track을 다시 대조한다.
3. 검증 전 트랙은 video/audio에 attach하거나 재생하지 않는다. 미확인 트랙은 현재 수신자 세대 전체에서 최대 12개·도착 후 2초만 보류하고 초과/만료분은 detach·unsubscribe 후 requestBindingsRefresh({matchId,mediaInstanceId,receiverGeneration,lastBindingRevision})를 호출한다. 다음 바인딩에서 SDK의 기존 publication을 다시 대조해 현재 승인된 것만 복구한다. 무제한 큐·polling은 만들지 않는다. 본 경기의 다른 활동자 최대 5명, 연습 같은 인스턴스 최대 2명의 저해상도 얼굴만 수신한다. C는 media-bindings-refresh로 B의 현재 검증 목록 재전송을 요청하며 Cloud 무제한 조회를 추가하지 않는다.
4. 삭제·세대/SID 교체에는 전체 식별자와 null callback으로 C texture를 먼저 해제하고 video를 detach·srcObject 해제·remove한다. 자기 receiverGeneration 교체는 전체 정리하지만 원격 한 명의 publisherGeneration 교체는 그 사람 자원만 바꾼다. 구 SID/세대 사건은 새 element를 닫지 못한다.

**연결 계약과 경계**

- 개인media-bindings만신원매핑근거; 원본좌표/역할/출구metadata추정금지.
- D track/video 소유와 C VideoTexture 소유를 분리한다. pending-tracks는 영상·오디오 합산 12개/2초의 공통 보류 저장소이며 ME-06이 재사용한다. 허용 binding마다 기존 SDK publication을 대조해 복구하되 검증 전 attach/play는 금지한다.

**시험 입력 → 기대 결과**

- 모르는 participant 또는 identity/세대 불일치 → attach/callback/play 없음; 12개/2초 보류 상한과 만료 정리 준수.
- 트랙→바인딩, 바인딩→트랙, 삭제→늦은 트랙 순서 → 같은 현재 세대 결과; 뒤늦은 바인딩에도 기존 publication 재대조로 얼굴 연결.
- 한 명만 전체 재연결 → 그 player publisherGeneration과 얼굴만 교체, 다른 다섯 연결/texture와 receiverGeneration 유지.
- 한playerSID1→SID2뒤SID1unsubscribed → SID1null만처리,새SID2element유지.
- 얼굴5개사전수신이나가시성0 → D수신가능,C렌더0; 연습다른팀binding없음 → 수신허용없음.
- 종료/재경기반복 → video/detach등록수누적없음.

**추가·보완할 시험 파일**

- `apps/web/src/features/media/remote-faces.test.ts`
- `apps/web/src/features/media/media-bindings.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/media/remote-faces.test.ts apps/web/src/features/media/media-bindings.test.ts apps/web/src/features/media/pending-tracks.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

본 경기의 다른 활동 참가자 최대 5명 얼굴을 저해상도로 수신하고 연습에서는 같은 팀만 수신한다. 트랙/바인딩 양쪽 도착 순서와 한 명만 재연결하는 실제 계약 fixture를 통과한다. 미확인 트랙 최대 12개·2초 보류와 정리·refresh를 확인하고 SID·세대 교체·퇴장에 자원을 해제한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 검증된 참가자 얼굴 수신과 교체 처리
```

**MR 본문에 채울 변경 사항**

- B신원·SID매핑과원격video수명연결
- 세대·구독·퇴장에따른Ctexture해제알림

**MR 리뷰 포인트**

- 임의metadata신원추측과다른연습팀연결여부
- SID교체경쟁·detach순서·nullcallback멱등성

**완료 인계**

- C VI-04에 전체 세대 식별자와 element/null 순서 fixture를 전달한다. B/E의 실제 바인딩 직렬화 객체를 D reconcile에 넣어 양방향 도착 순서·한 명 재연결을 계약 시험으로 검증한다.
- B에media-bindings실제개인메시지생산을확인하고F에재게시수신통계초기화사례전달.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/ME-05.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/ME-05.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-16

**ME-06 · [FE] 근거리 오디오 그래프·효과음 재생**  
일정: D2 2026-09-09 · **오늘 4번**  
기획 근거: v0.0.8 **14장**  
선행 완료 결과: [D-13](d-vision-media.md#d-13) (ME-03, D2), [D-15](d-vision-media.md#d-15) (ME-05 공통 트랙 보류·바인딩 reconcile, D2), [E-06](e-media-operations.md#e-06) (MC-03, D2), [E-07](e-media-operations.md#e-07) (MC-04, D2)

**수정·생성 파일**

- `apps/web/src/features/media/audio-graph.ts`
- `apps/web/src/features/media/audio-graph.test.ts`
- `apps/web/src/features/media/audio-policy.ts`
- `apps/web/src/features/media/audio-policy.test.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`

**구현 순서**

1. 사용자 제스처로 열린 AudioContext를 재사용한다. 실제 오디오 트랙·검증 media-bindings·audio-policy를 각각 저장하고 어느 입력이 바뀌어도 reconcile한다. 세 입력이 일치할 때만 SID당 Source→Filter→Gain→Panner→Destination을 한 번 연결하고 audio element attach 재생을 추가하지 않는다.
2. 별도 audio-policy 채널의 matchId/mediaInstanceId/receiverGeneration/policyRevision/bindingRevision을 검증한다. 정책이 참조하는 정확한 bindingRevision과 각 player publisherGeneration·audioTrackSid가 준비돼야 적용한다. 최신 정책보다 낮은 revision, 다른 인스턴스·수신자 세대는 폐기한다. 불일치/미확인 동안 출력 0을 유지하고 숨은 좌표를 요청하지 않는다.
3. 정책에서 사라진 voice의 출력을 즉시 닫고 그래프를 해제한다. 실제 SFU 수신 권한 회수는 E가 담당하며 gain=0을 접근 차단 통과로 보고하지 않는다.
4. 효과음은 서버의 eventId로 중복을 막고 승인된 발소리·장비 사건만 재생한다. 로컬 거리로 효과음을 새로 판정하거나 지도 표식으로 바꾸지 않으며 마이크 거부 상태에서도 수신한다. 제품 결정 대기의 아이템 효과음을 구현·검수에 포함하지 않는다.
5. COUNTDOWN·개인 종료·권위 상실에는 master gain을 즉시 닫고 종료 시 노드·효과음 source를 정리한다. 5–6셀 완충과 실효 차단 지연은 F/E의 실제 통합으로 확인한다.

**연결 계약과 경계**

- AudioPolicy와 audio-policy 채널의 정확한 타입은 중앙 계약을 사용한다. receiverGeneration은 수신자, participants의 publisherGeneration은 각 송신자다. 정책 revision과 참조 bindingRevision을 같은 정수라고 가정하지 않는다.
- B미디어binding검증과E SFU강제권한이전제. clientaudio그래프는표현층만담당.

**시험 입력 → 기대 결과**

- 같은voicepolicy두번 → source/graph1개,중복음성없음.
- 마이크denied+유효remoteaudio →수신재생가능; 가청정책제거 →master/voice즉시차단.
- 구 receiverGeneration/인스턴스/정책 revision, 미확인 SID, NaN gain → 그래프 생성·재생 없음.
- 트랙·바인딩·정책의 6가지 도착 순서 → 최종 그래프와 재생이 동일하고 승인 전 출력 0.
- 정책이 미래 bindingRevision 참조 → 해당 바인딩까지 출력 대기; 바인딩 교체로 현재 정책이 불일치하면 즉시 mute·refresh, 오래된 정책으로 새 SID 재생 없음.
- 미확인 트랙 13개 또는 2초 초과 → D ME-05와 공유한 상한으로 detach/unsubscribe·바인딩 refresh, 이후 승인된 publication 재대조.
- 같은effecteventId재전송 또는COUNTDOWN →중복/조기효과음0.

**추가·보완할 시험 파일**

- `apps/web/src/features/media/audio-graph.test.ts`
- `apps/web/src/features/media/audio-policy.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/media/audio-graph.test.ts apps/web/src/features/media/audio-policy.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

서버 파생 gain/방향/filter로 Source→Filter→Gain→Panner를 구성한다. 사용자 제스처로 재생을 시작하고 마이크 거부 상태에서도 듣는다. audio 요소 중복 재생·가청 밖 효과음·원본 좌표 이용이 없다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 근거리 음성과 효과음의 공간 재생 연결
```

**MR 본문에 채울 변경 사항**

- 검증된트랙의WebAudio단일그래프구성
- 서버파생음향·정책제거·효과음중복제어

**MR 리뷰 포인트**

- audio요소중복재생·원본월드좌표의존여부
- 클라mute와실제SFU차단을구분한증거

**완료 인계**

- C FL-02/07에audioPlayback상태와COUNTDOWN출력잠금동작을전달한다.
- F QA-01/12에trackSid별실효표식수신과정책결정/재생시각계측hook제공.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/ME-06.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/ME-06.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.

### D-17

**ME-07 · [FE] 미디어 세대 종료와 참가 종료 분리**  
일정: D2 2026-09-09 · **오늘 5번**  
기획 근거: v0.0.8 **18, 24장**  
선행 완료 결과: [D-14](d-vision-media.md#d-14) (ME-04, D2), [D-15](d-vision-media.md#d-15) (ME-05, D2), [D-16](d-vision-media.md#d-16) (ME-06, D2), [E-10](e-media-operations.md#e-10) (MC-07, D2)

**수정·생성 파일**

- `apps/web/src/features/media/media-lifecycle.ts`
- `apps/web/src/features/media/media-lifecycle.test.ts`
- `apps/web/src/features/input/InteractionRuntime.ts`
- `apps/web/src/features/input/InteractionRuntime.test.ts`

**구현 순서**

1. retireMediaGeneration은 세대를 먼저 terminal로 바꿔 새 게시·구독·복구를 막는다. 출력을 즉시 닫고 listener·재연결·가공 게시/수신 트랙·video를 정리한 뒤 SDK disconnect를 기다린다. 로컬 closed와 서버 회수 성공을 구분한다.
2. 정상 세대 교체는 playerId·게임 Room·원본 카메라와 필요한 센서를 유지한다. 마이크 원본과 게시용 clone의 소유를 구분해 SDK disconnect가 보존할 장치를 닫지 않게 한다. 새 grant는 B/E 회수 확인 뒤에만 받는다.
3. endParticipation은 입력 timer/listener·Worker/model·원본 장치까지 닫는다. 개인 대기의 게임 Room 유지·실제 퇴장은 C가 결정한다. dispose는 객체 재사용을 금지하며 새 라운드 startDevices가 가능한 endParticipation과 구분한다.
4. 게임 생존 중에만 SDK 순간 복구를 허용하고 서버 10초 창을 따른다. UNKNOWN·권위 상실·개인 종료 뒤 Reconnected나 늦은 publish가 현재 세대를 다시 열지 못하게 한다.
5. 동시 socket close·개인 종료·unmount는 공유 종료 Promise로 한 번만 정리한다. 카메라·추론 장애만 생기면 IN-10의 보조 입력·안전 얼굴로 전환한다.

**연결 계약과 경계**

- retireMediaGeneration():Promise<void>, endParticipation():Promise<void>, dispose():Promise<void>; C가게임Room수명소유.
- 정상세대교체는기존game참가유지,원격회수는MC-07/08. 로컬SDKdisconnect로원격완료를보증하지않는다.

**시험 입력 → 기대 결과**

- 연습세대retire → oldvideo/track/graph닫힘,playerId·게임Room·필요원본카메라유지.
- 개인종료+socketclose+unmount동시 → stop/detach/terminate한번,자동재연결없음.
- retire 후 늦은 Reconnected/publish/바인딩/AudioPolicy → 현재 receiverGeneration을 다시 열지 못하고 즉시 정리, 새 grant/ready 발생 없음.
- 한 명만 재연결 또는 원격 publisherGeneration 교체 → 나머지 참가자 연결·장치·트랙을 전체 종료하지 않음.
- 카메라만장애 → 게임/미디어세대유지와안전얼굴; 서버MEDIA_POLICY_UNCERTAIN →10초대기없이종료.

**추가·보완할 시험 파일**

- `apps/web/src/features/media/media-lifecycle.test.ts`
- `apps/web/src/features/input/InteractionRuntime.test.ts`

**실행할 검사**

```bash
pnpm build:packages
pnpm exec vitest run apps/web/src/features/media/media-lifecycle.test.ts apps/web/src/features/input/InteractionRuntime.test.ts
pnpm typecheck
pnpm lint
```

**완료 조건**

세대 교체에서는 playerId·게임 연결을 보존한다. 개인 종료/퇴장/권위 상실에서는 게시·수신·재연결·트랙·오디오 그래프를 멱등 정리한다. 카메라 실패만으로 전체 종료하지 않고, 게임 생존 중 LiveKit 순간 복구만 10초 허용한다.

위 조건과 필요한 실제 연결·검증이 충족됐을 때만 완료로 표시한다. 해당 작업의 검사 실패나 필수 연결 대기는 진행 기록과 MR 본문에 그대로 남긴다.

**작업 완료 커밋 제목**

```text
feat: 미디어 세대와 게임 참가 종료 수명 분리
```

**MR 본문에 채울 변경 사항**

- terminal세대차단과멱등로컬정리
- 원본장치보존교체·개인종료·권위상실경로분리

**MR 리뷰 포인트**

- SDKdisconnect의원본track영향과C/D중복해제
- 로컬closed/서버회수확인/새grant장벽의구분

**완료 인계**

- C SessionRuntime/FL-09/10에세가지종료메서드와새라운드재초기화수명을fixture로전달한다.
- E MC-08에클라closed신고와회수확인순서를전달하고F에반복종료·재연결경쟁의자원count검증인계.
- 실행 후 해당 작업의 실제 검사 결과·commit SHA·미통합 선행을 .local/mr/D/ME-07.md 5개 항목에 채운다. 현재 문서의 계획 문구를 성공 결과로 복사하지 않는다.

완료 후 실제 검사와 commit SHA를 포함한 다섯 항목 MR 본문을 `.local/mr/D/ME-07.md`에 작성하고 해당 날짜의 합본에도 반영한다. 파일 링크와 복사 가능한 본문을 답변으로 제공한다. 푸시와 MR 생성은 담당자가 직접 수행한다.
