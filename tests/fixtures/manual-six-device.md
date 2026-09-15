# QA-09 · 대표 장치 6대 5판 수동 기록 양식 (F-15)

같은 빌드·유효한 시간·실제 허용 영상/음성 대조와 마이크 거부 경로를 검사한다. 합성 기록은 실제 G5 인수가 아니다. 시험 순서와 종합 판정은 [테스트](../../docs/testing.md)를 따른다.

G5 실장치 완료의 **기준 파일**은 이 양식대로 사람이 채운 `.local/qa/six-device/` 기록이다.
자동 브라우저(QA-09-browser)는 보조 증거일 뿐이며, 이 기록이 없으면 G5 는 PASS 가 될 수 없다.
`node scripts/collect-six-device-results.mjs --input .local/qa/six-device --output .local/qa/QA-09.json` 이
빈 칸·누락·불일치를 nonzero 로 돌려준다. 빈 칸을 자동으로 통과로 채우지 않는다.

## 시작 전 확인 (하나라도 아니면 5판을 시작해도 MVP 완료가 아니다)

- [ ] G1-A~D · G3 · G4 · ready · TLS 의 **실제** 결과가 관문 manifest(`.local/qa/mvp-gates.json`)에 있다 (Cloud 미실시면 그대로 적는다)
- [ ] 장치 6대·사용자 6명·네트워크·중간/하위 preset 이 `devices.json` 에 있다
- [ ] LiveKit 공식 분/GB 잔량을 확인했고 5판 예산이 잔량 안이다
- [ ] 촬영/녹음을 **저장하지 않는다**는 데 6명이 동의했다 (실시간 기능만)

## 파일 1 · `devices.json`

```json
{
  "sourceCommit": "<git rev-parse HEAD>",
  "network": {
    "kind": "campus-wifi-6e",
    "measured": "RTT 12ms / 다운 210Mbps / 업 95Mbps (speedtest 2026-09-11 10:02)"
  },
  "devices": [
    {
      "deviceId": "dev-1",
      "realDevice": true,
      "model": "Samsung Galaxy Book 960XGL",
      "os": "Windows 11 Enterprise 26200",
      "browser": "Chrome 152.0.7977",
      "camera": "Intel AVStream",
      "preset": "mid",
      "participant": "P1",
      "verifiedAt": "2026-09-11T09:50:00+09:00"
    }
  ]
}
```

- `devices` 는 **정확히 6개**, `deviceId` 는 서로 다르고, 모두 `realDevice: true` 여야 한다. 브라우저 context 6개를 한 장치에서 띄운 것은 6대가 아니다.
- `preset` 은 `mid`(목표 평균 45fps) 또는 `low`(목표 30fps).

## 파일 2 · `matches.json`

```json
{
  "sourceCommit": "<실제 배포 SHA, devices.json과 동일>",
  "matches": [
    {
      "matchId": "<서버 matchId>",
      "order": 1,
      "sourceCommit": "<이 판을 실행한 실제 배포 SHA>",
      "startedAt": "2026-09-11T10:10:00+09:00",
      "endedAt": "2026-09-11T10:13:20+09:00",
      "result": "two-captured | two-escaped | timeout",
      "rematch": "same | swap | lobby | none",
      "coverage": [
        "invite-entry",
        "camera-mic-independent",
        "calibration",
        "team-practice",
        "loading-countdown",
        "three-minute-round",
        "result-screen"
      ],
      "devices": {
        "dev-1": {
          "fpsAvg": 52,
          "fpsMin": 41,
          "remoteFaces": 2,
          "cameraReady": true,
          "microphonePermission": "denied",
          "micDeniedAction": "map-exchange",
          "nearVoice": true,
          "audioDuplicate": false,
          "playbackPermission": "granted",
          "afterEnd": { "tracks": 0, "workers": 1, "textures": 12, "rooms": 0 }
        }
      },
      "mediaChecks": [
        {
          "receiverDeviceId": "dev-1",
          "senderDeviceId": "dev-2",
          "kind": "audio",
          "allowed": true,
          "observed": true,
          "observedAt": "2026-09-11T10:11:00+09:00"
        }
      ],
      "failures": []
    }
  ]
}
```

- `matches` 는 **정확히 5개**, `order` 1~5 연속, 모두 `result` 와 `endedAt` 이 있어야 한다.
- 각 판의 `devices` 에 6개 `deviceId` 가 전부 있어야 한다.
- `afterEnd` 는 판 종료 후 DevTools 로 읽은 남은 Track/Worker/Texture/Room 수. 5판에 걸쳐 **증가하면 누수**로 실패한다 (재경기 완주만으로는 통과하지 않는다).
- `failures`에 남은 실패가 있으면 그 5판 묶음은 통과하지 않는다. 실패·수정 이력은 별도 기록하고 수정된 동일 빌드에서 5판을 다시 검증한다.
- 모든 시각은 시간대가 있는 유효한 ISO 시각이다. 장치 확인은 첫 판 시작 전이며 각 판은 종료가 시작 뒤이고 다음 판과 겹치지 않는다. 전체/판별 `sourceCommit`은 devices.json과 일치해야 한다.
- `remoteFaces`는 0~5 정수다. 모든 시점에 5명이 보여야 하는 것은 아니지만 각 장치는 5판 중 허용 영상/음성 수신을 최소 한 번씩 실제 확인한다. 각 판에도 허용 영상·음성의 양성 표본이 필요하다.
- `mediaChecks`에는 실제 송신/수신 장치, video/audio, 서버 허용 여부와 관찰 여부, 판 안의 관찰 시각을 적는다. 자기 자신·미등록 장치·허용/관찰 모순은 거절한다. 원본 영상·음성은 저장하지 않는다.
- 마이크 거부자는 `microphonePermission: denied`, `cameraReady: true` 상태에서 음성을 수신하고 `micDeniedAction: map-exchange|escape` 중 하나를 실제 수행한 기록이 최소 한 번 필요하다. coverage 태그만으로 대신하지 않는다.

## 필수 행동 coverage (5판 합쳐서 최소 1회씩)

| 태그                                              | 의미                                                           |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `invite-entry`                                    | 초대 링크로 입장                                               |
| `camera-mic-independent`                          | 카메라·마이크 권한이 서로 독립 (거부 1명 포함)                 |
| `mic-denied-user`                                 | 마이크 거부 사용자가 카메라 준비·수신 음성·지도 교환/탈출 가능 |
| `calibration`                                     | 보정                                                           |
| `team-practice`                                   | 팀 연습                                                        |
| `loading-countdown`                               | 로딩 → 3초 카운트다운                                          |
| `three-minute-round`                              | 실제 3분 경기                                                  |
| `result-screen`                                   | 결과 화면                                                      |
| `rematch-same` · `rematch-swap` · `rematch-lobby` | 같은 역할 / 교대 / 로비 재경기 (세 종류 모두)                  |
| `map-exchange`                                    | 지도 교환                                                      |
| `sensor`                                          | 감지기 설치·발동                                               |
| `trap`                                            | 덫 설치·구속                                                   |
| `restraint-expiry`                                | 자연 구속 만료·유예                                            |
| `capture`                                         | 포획                                                           |
| `pose-left` · `pose-right` · `pose-y`             | 3 포즈 탈출                                                    |
| `pose-fallback`                                   | 포즈 폴백(키) 탈출                                             |
| `past-event-marker`                               | 확정된 과거 교환/감지 사건 점을 술래가 봄                      |
| `personal-end-leave`                              | 개인 종료자 퇴장                                               |
| `connection-lost-notice`                          | 게임 연결 상실 안내                                            |

## 결정 대기 (필수 coverage 아님, 사용 여부만 `pending` 에 기록)

MP-06 · EQ-06 · EQ-07 · EQ-08 · EQ-09 · EQ-12 · G3-C (아이템 종류·효과·획득·사용·전용 음향·해제 사건). 사용하지 않았어도 실패 항목이 아니다.

## 판정 목표와 현재 검사 한계 (collect-six-device-results)

- 장치6·판5·coverage·누수/FPS 목표뿐 아니라 실제 허용 관계의 영상/음성 대조·유효한 순차 시간·같은 배포 SHA까지 확인해야 G5를 인수한다. 집계기가 이 정합성을 검사한다. 실제 장치에서 해당 기록을 얻는 작업은 여전히 사람의 관찰이 필요하다.
- 어느 하나라도 빈 칸 → `INCOMPLETE` (PASS 아님)
- `realDevice:false` 포함, coverage 누락, 누수 증가, FPS 미달 → `FAIL`
- 결정 대기 항목 미사용은 어떤 경우에도 실패가 아니다
