// S15P21C204-322. 배포된 이미지의 취약점 스캔. 하루 한 번.
//
// 예전에는 `kkakkung`·`kkakkung-mr` 파이프라인의 `Scan images` 단계가 매 빌드 Trivy 를 두 번
// 돌렸다. 그 단계는 `--exit-code 0` 이라 HIGH/CRITICAL 이 나와도 아무것도 막지 않았고, MR 빌드가
// 스캔하던 이미지는 배포되지도 않았다. 그러면서 무거운 단계 잠금을 1~3분 쥐고 있어 다른 잡이
// 그만큼 줄을 섰다. 막지 않는 기록을 매 빌드 만들 이유가 없어 여기로 옮겼다.
//
// 대상은 **지금 배포돼 있는 것**(`$STATE_DIR/last-good-tag`)이다. 취약점은 대부분 베이스 이미지
// (node·nginx)에서 오고 커밋마다 달라지지 않으므로 하루 한 번이면 같은 것을 본다.
//
// 잡 만들기는 infra/jenkins/SETUP.md 13장.
pipeline {
  agent any

  triggers { cron('H 5 * * *') }

  options {
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '30'))
    timeout(time: 30, unit: 'MINUTES')
    timestamps()
  }

  environment {
    STATE_DIR = '/opt/kkakkung'
    IMG_GAME = 'kkakkung-game'
    IMG_WEB = 'kkakkung-web'
    // 태그 고정: :latest 는 원격이 움직일 때마다 다시 받고, 어떤 DB·판정으로 통과했는지
    // 나중에 되짚을 수 없다. 올릴 때는 이 줄만 바꾼다.
    TRIVY_IMAGE = 'aquasec/trivy:0.74.0'
  }

  stages {
    stage('Scan images') {
      steps {
        // 취약점이 있어도 잡을 실패로 만들지 않는다(`--exit-code 0`). 이 잡의 실패는 "스캔을
        // 돌리지 못했다"는 뜻이어야 한다: 태그가 없거나 Trivy 가 뜨지 않은 경우.
        sh '''
          tag="$(cat "$STATE_DIR/last-good-tag" 2>/dev/null || true)"
          if [ -z "$tag" ]; then
            echo "마지막 정상 배포 태그가 없습니다 ($STATE_DIR/last-good-tag). 스캔할 이미지가 없습니다."
            exit 1
          fi
          echo "스캔 대상 태그: $tag"
          for img in "$IMG_GAME:$tag" "$IMG_WEB:$tag"; do
            if ! docker image inspect "$img" > /dev/null 2>&1; then
              echo "이미지가 없습니다: $img (정리됐거나 아직 빌드되지 않음)"
              exit 1
            fi
            echo "=== $img"
            # 무거운 단계 잠금: 다른 빌드의 vitest(250ms tick 판정)와 CPU 를 나누지 않는다 (SETUP.md §6).
            flock /var/lib/jenkins/verify.lock \
              docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache/ \
                "$TRIVY_IMAGE" image --severity HIGH,CRITICAL --no-progress --exit-code 0 "$img"
          done
        '''
      }
    }
  }
}
