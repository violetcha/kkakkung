# 입장 개방 전 최초 기동 실패 복구

관련 Jira는 S15P21C204-195다. 일반 배포와 rollback은 계속 drain 완료를 요구한다.
이 절차는 이전 서버의 drain은 성공했지만 새 서버의 최초 원격 조회 복구가 실패해
한 번도 입장을 열지 못한 경우에만 적용한다. READY·미해결 회수 값을 바꾸거나 기록을
지워서 재시작하는 절차가 아니다.

## 적용 조건

- 실패 배포의 manifest와 release.json이 모두 있고, manifest·이미지·격리·이전 drain·새
  compose·RECOVERING·READY_TIMEOUT·rollback drain 실패가 정확한 순서로 기록돼 있다.
  READY/resume/smoke/last-good 성공이나 다른 이미지 교체가 끼어 있으면 차단한다.
- 실행 중인 game/web 이미지가 실패 manifest와 같고, 게임 프로세스가 해당 drain과
  compose 완료 사이에 처음 시작했으며 재시작 횟수가 0이다.
- 팀원 SSO·continuous product·단일 운영 볼륨 writer가 유지되고,
  admission은 닫혀 있으며 health의 유일한 잠금 이유가 REMOTE_RETIREMENT_UNCONFIRMED다.
- 저널은 최초 기동 이후 쓰이지 않았다. 연속 순번·checksum·namespace·방 소유권과
  기존 최신 REVOKED 기록을 검사하며, 토큰이 모두 기동 전에 만료됐어야 한다.
- cleanup은 이력 완전·관측 참가자 0·미회수 identity 0·남은 방 0인 조회 실패만 포함한다.
  retry는 모두 REVOKED이고 관련 사용량 예약도 원격 확인된 종료 상태다.
  원래 재시도 파일이 없는 경우에는 최신 저널에 대기 중인 기록이 하나도 없을 때만
  기존 복구 계약대로 부재를 인정한다. 빈 재시도 파일을 새로 만들지 않는다.
- 수정 이미지와 실패 이미지가 참조하는 이전 last-good가 같다. 압축된 저널,
  손상된 기록, 신규 발급·미해결 참가자·활성 예약·다른 writer는 이 경로의 대상이 아니다.

## 실행

먼저 수정 커밋의 전체 검사와 Jenkins 이미지 빌드가 통과해야 한다. 검증된 커밋을
체크아웃한 호스트의 root 셸에서 기존 제품 배포 러너에 실패한 최초 기동의 8자리 태그를
명시한다. 호스트 운영 볼륨을 읽고 정상 종료·백업할 권한이 필요하다.
Jenkins 자동 배포에는 이 옵션을 기본으로 넣지 않는다.

```sh
node --import tsx scripts/product-release.mjs \
  --env-file /opt/kkakkung/production.env \
  --evidence-dir /opt/kkakkung/runtime-evidence \
  --sha <검증된-수정-커밋-40자리-SHA> \
  --recover-failed-startup <실패한-최초-기동-8자리-태그>
```

러너는 기존 자격 전달 경로와 loopback 운영 API를 사용한다. LiveKit 키를 별도 진단
프로세스로 추출하거나 새 시험 자원을 만들지 않는다. 교체 후 기존 DP-06 배포 시험은
원래 배포 경로대로 실행한다.

상태를 두 번 대조하고, 중지 직전에도 컨테이너·저널이 바뀌지 않았는지 확인한다.
해당 컨테이너만 정상 종료시키며 exit 0·writer.lock 해제·같은 볼륨의 다른 writer 없음·
저널과 checkpoint 불변을 확인한다. SIGKILL, 정상 종료 실패, 기록 변경 또는 백업 실패면
후속 이미지 교체를 멈춘다. lock 파일을 강제로 삭제하거나 파일을 초기화하지 않는다.

중지된 볼륨 파일을 호스트의 `/opt/kkakkung/recovery-backups/` 아래 새 비공개 디렉터리에
복사하고 파일별 hash·순번·실패 SHA를 남긴다. 파일과 디렉터리를 sync한다.
이 백업은 호스트 내부 복구 자료이며 외부 백업·실제 복원 훈련의 통과 증거는 아니다.

검증된 수정 이미지도 새 단일 writer 아래 모든 과거 방의 원격 복구를 다시 수행한다.
이후 READY → 운영 resume terminal 성공 → OPEN → 기존 DP-06 smoke → 게시 조건
재확인 → last-good 기록을 모두 통과해야 배포 성공이다. 복구가 또 실패하면 일반 rollback의
drain을 요구하며 이 예외를 재사용하지 않는다. 기존 실패 release.json은 보존한다.

## 검증 범위

최초 기동 증거·신규 발급·상태 변경·다중 writer·손상·미회수·비정상 종료 차단,
배포 러너 연결과 실패 rollback은 로컬 회귀로 검사한다. 실제 호스트에서의 정상 종료,
볼륨 보존, 원격 복구 및 배포 성공은 실행 후 SHA·release.json·READY/OPEN으로 별도 확인한다.
