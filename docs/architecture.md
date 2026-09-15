# 아키텍처

까꿍은 4개 workspace로 구성한다.

```text
apps/web ───────────────> packages/protocol
server ─────────────────> packages/protocol
server ─────────────────> packages/game-core
```

game-core는 protocol에도 의존하지 않는다. 서버 adapter가 검증된 wire 명령에 서버가 확인한 playerId를 붙여 순수 규칙에 전달한다. 웹은 서버 전체 맵·비공개 위치·튜닝·운영 데이터를 import하지 않는다.

## 제품 실행 경로

`SERVER_PROFILE=product`가 실제 kkakkung 0.2 Room과 A/B/E/F 조립을 선택한다. 서버는 명령·미디어 응답을 20Hz 권위 Tick에 반영하고, 코어가 맵·이동·장비·구속·포획·포즈·승패를 판정한다. 공개 라운드/로스터와 수신자별 private view·사건을 분리하며 웹에는 관찰 가능한 상태만 전달한다.

초대·GitLab 프로젝트 멤버·게스트 인증 → 세션 발급 → RESERVED 좌석 → 인증된 Colyseus 연결 → 6인 DEVICE_CHECK → TEAM_PRACTICE → MAP_FINALIZING → GAME_LOADING → COUNTDOWN → PLAYING → RESULT/ABORTED 순서다. 방장이 재경기를 선택하면 새 matchId로 준비를 시작한다. 미디어 회수를 확인하기 전에는 발급 장벽이나 RETIRING 좌석을 임의로 해제하지 않는다.

입장 예약은 연결되지 않으면 60초에 만료된다. 소유 세션의 취소도 예약을 반환하며 이미 연결된 참가자나 회수 중 좌석은 이 경로로 퇴장시키지 않는다. 입장 후 세션 수명과 예약 만료는 별개다. 전송 규약은 [protocol](protocol.md)을 따른다.

## 브라우저 조립

`App.tsx`가 초대 fragment를 소비하고 `ProductApp.tsx`가 화면을 조립한다. `product-runtime.ts`는 Room 상태·명령 수명·미디어 흐름을 묶고 `interaction-bridge.ts`가 D의 `InteractionRuntime`에 입력 문맥을 전달한다. 단일 WorldCanvas는 수신 상태를 표현하며 권위 판정을 만들지 않는다.

장치 관리자는 원본 카메라·마이크 수명을 소유한다. 비전 Worker는 고정 모델로 얼굴·포즈·손을 추론한다. 보정은 모델 준비 후 새 얼굴·포즈 표본으로 시작한다. 독립 출력 감시가 가공 Canvas를 유지해 추론 중단이나 카메라 소실 시 기본 얼굴로 전환한다. 복구는 새 보정을 거치며 키보드 선택을 자동으로 덮어쓰지 않는다.

실제 음성 그래프와 사용자 제스처로 잠금을 해제하는 AudioContext는 같은 인스턴스다. 마이크만 꺼지거나 교체되면 해당 게시만 갱신하며 게임 연결과 가공 얼굴 트랙을 유지한다.

| 수명                                        | 소유·종료 범위                                    |
| ------------------------------------------- | ------------------------------------------------- |
| 게임 참가와 matchId/gameScope               | B 권위 상태와 C 참가 런타임                       |
| receiverGeneration·mediaInstanceId·Identity | E 발급/회수와 C/D 미디어 연결                     |
| 로컬 runtimeGeneration·Worker·장치          | D 추론 및 장치 복구                               |
| 가공 Canvas·출력 안전 감시                  | 참가 수명 동안 유지, 참가 종료 시 정리            |
| 음성 그래프                                 | 세대 종료 시 노드 정리, 참가 종료 시 Context 종료 |

이 세대 값들은 서로 대체하지 않는다. 미디어 전용 재연결은 논리 참가를 보존하지만 게임 소켓 종료는 현재 참가 복귀를 보장하지 않는다. 세부 수명은 [미디어](media.md)를 따른다.

## 미디어와 운영

`server/src/media`는 바인딩·발급·회수·권한을, `server/src/operations`는 지속 저널·사용량·명령·복구 장벽을, `server/src/health`는 준비 상태 판정을 소유한다. `server/src/config/RuntimeEvidence.ts`가 운영 설정 파일을 연결한다. `MEDIA_MODE=livekit` 설정만으로 READY를 만들지 않으며 유효한 capability·예산·복구가 필요하다.

운영 미디어 방식은 `publisher-permissions`다(D-2026-09-15-01, 최대 10방). 게시 전 기본 차단, 확인된 바인딩, 허용 목록 만료·회수, SSO 또는 초대 인증·예산을 유지한다. 변조 송신 앱의 허용 목록 확대 위험은 수용한 상태이며 서버 단독 통제 후보(`server-forwarding`)는 보류했다. 모드별 Cloud capability 보고서는 섞지 않는다. 운영 정책은 [운영](operations.md)을 따른다.

한 프로세스가 모든 방의 tick을 50ms 주기로 돌린다. 한 방의 tick 예외는 그 방만 `SERVER_TICK_OVERLOAD`로 끝내고 다른 방은 계속 진행한다. 예정 시각보다 250ms 넘게 밀리면 해당 경기를 무효로 한다. 방마다 반복되는 권한·readiness 평가가 방 수에 비례해 누적되지 않도록 캐시와 방 범위 조회를 유지한다.

## 진단과 배포 경계

기본 개발 프로필은 보존된 kkakkung 0.1 셀 계약과 별도 sandbox 벡터 계약을 제공한다. 진단의 전체 maze 공개나 메시지 시점 셀 이동을 제품 0.2의 동작으로 설명하지 않는다. 개발 빌드의 `/`는 초대가 없으면 진단 화면이며 `/play`·초대 링크와 배포 빌드는 제품 화면이다.

`NODE_ENV=production`은 현재 거절한다. 제품 배포는 명시적 product 프로필과 development 환경으로 실행하며 Jenkinsfile·배포 러너가 검증·이미지·복구·smoke를 연결한다. 배포 완료는 별도 release 증거로 확인한다. 원격 설정과 실제 기기·Cloud 인수는 [테스트](testing.md) 및 [인프라](../infra/README.md)를 따른다.
