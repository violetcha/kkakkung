// 까꿍 CI/CD
//
// 서버 한 대. 컨트롤러에서 바로 빌드하고 같은 호스트에 배포합니다.
// 레지스트리는 두지 않고 커밋 SHA 태그만 유지합니다. 롤백은 이전 태그로 compose up.
// 검증 명령은 저장소의 pnpm 스크립트(CONTRIBUTING.md)를 그대로 씁니다.

pipeline {
  agent any

  options {
    // GitLab 커밋 상태 게시 (Jenkins 관리 → System → GitLab connection 'ssafy-gitlab', 크리덴셜 gitlab-api-token)
    gitLabConnection('ssafy-gitlab')
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 40, unit: 'MINUTES')
  }

  environment {
    IMG_GAME  = 'kkakkung-game'
    IMG_WEB   = 'kkakkung-web'
    // 개발용 compose.yaml 위에 운영 override 를 덧씌웁니다 (docs/execution/f-infra-qa.md DP-02).
    COMPOSE   = '-f infra/compose.yaml -f infra/compose.production.yaml'
    STATE_DIR = '/opt/kkakkung'
    READY_URL = 'http://127.0.0.1:8080/health/ready'   // web-proxy 경유 → game-server
    DEPLOY_BRANCH = 'develop'
    // 검증 도구체인은 infra/docker/Dockerfile.ci (Node 24.19.0 + pnpm 11.19.0 + Playwright Chromium).
    // 파일 해시로 태그해서 Dockerfile.ci 가 바뀔 때만 다시 빌드합니다.
    CI_IMAGE   = 'kkakkung-ci'
  }

  stages {

    stage('Prepare') {
      steps {
        script { env.FAILED_STAGE = env.STAGE_NAME }
        updateGitlabCommitStatus name: 'jenkins', state: 'running'
        script {
          env.TAG = sh(script: 'git rev-parse --short=8 HEAD', returnStdout: true).trim()
          env.GIT_SHA = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
          // GitLab 이 보낸 검증 대상 SHA 와 실제 체크아웃이 같은지 대조합니다 (DP-04).
          // 웹훅 빌드에서만 값이 오고, 수동 빌드에선 비어 있어 건너뜁니다.
          def head = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
          def expected = env.gitlabAfter ?: (env.gitlabMergeRequestLastCommit ?: '')
          if (expected && expected != head) {
            error("체크아웃된 커밋(${head})이 GitLab 이 보낸 커밋(${expected})과 다릅니다. 배포 중단.")
          }
          def b = env.BRANCH_NAME ?: (env.GIT_BRANCH ?: '')
          env.IS_DEPLOY = (b == env.DEPLOY_BRANCH || b.endsWith('/' + env.DEPLOY_BRANCH)) ? 'true' : 'false'
          echo "commit=${env.TAG}  branch=${b}  deploy=${env.IS_DEPLOY}"
        }
        sh 'mkdir -p /var/lib/jenkins/.cache/pnpm-store'
        // 검증 대상 SHA 는 ci-verify.mjs 가 install 전에 다시 대조합니다 (DP-04).
        script {
          env.EXPECTED_SOURCE_SHA = env.gitlabAfter ?: (env.gitlabMergeRequestLastCommit ?: '')
          env.CI_TAG = sh(script: 'sha256sum infra/docker/Dockerfile.ci | cut -c1-12', returnStdout: true).trim()
        }
        sh '''
          if ! docker image inspect "$CI_IMAGE:$CI_TAG" > /dev/null 2>&1; then
            echo "CI 이미지 빌드: $CI_IMAGE:$CI_TAG"
            docker build -f infra/docker/Dockerfile.ci -t "$CI_IMAGE:$CI_TAG" infra/docker
          fi
        '''
      }
    }

    stage('Secret scan') {
      steps {
        script { env.FAILED_STAGE = env.STAGE_NAME }
        sh '''
          docker run --rm -v "$WORKSPACE:/repo" zricethezav/gitleaks:latest \
            detect --source=/repo --no-banner --redact --exit-code 1
        '''
      }
    }

    stage('Verify') {
      steps {
        script { env.FAILED_STAGE = env.STAGE_NAME }
        // 단일 진입점 scripts/ci-verify.mjs: 도구체인 확인 → EXPECTED_SOURCE_SHA 대조 → frozen install
        // → Chromium 확인 → pnpm verify 를 정확히 한 번 (format·check:execution·lint·typecheck·test·build·e2e).
        // 개별 pnpm 검사 목록을 여기 다시 나열하지 않습니다 (DP-04).
        // jenkins uid 로 돌려 root 소유 파일이 안 남게 하고, pnpm store 는 호스트 jenkins 홈에 캐시합니다.
        sh '''
          docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e CI=true -e EXPECTED_SOURCE_SHA="$EXPECTED_SOURCE_SHA"             -e npm_config_prefix=/tmp/npm -e PNPM_HOME=/tmp/pnpm -e npm_config_store_dir=/tmp/pnpm-store             -v /var/lib/jenkins/.cache/pnpm-store:/tmp/pnpm-store             -v "$WORKSPACE:/workspace" -w /workspace "$CI_IMAGE:$CI_TAG"             node scripts/ci-verify.mjs
        '''
      }
    }

    stage('Build images') {
      steps {
        script { env.FAILED_STAGE = env.STAGE_NAME }
        // 컨텍스트는 저장소 루트 (workspace 패키지 의존). 루트 .dockerignore 가 node_modules/dist 를 걸러줍니다.
        sh '''
          docker build -f infra/docker/Dockerfile.game-server -t "$IMG_GAME:$TAG" --label "org.opencontainers.image.revision=$GIT_SHA" .
          docker build -f infra/docker/Dockerfile.web         -t "$IMG_WEB:$TAG"  --label "org.opencontainers.image.revision=$GIT_SHA" .
        '''
      }
    }

    stage('Scan images') {
      steps {
        script { env.FAILED_STAGE = env.STAGE_NAME }
        // HIGH/CRITICAL 이 있어도 중단하지 않고 기록만 합니다. 발표까지 시간이 짧아서요.
        sh '''
          for img in "$IMG_GAME:$TAG" "$IMG_WEB:$TAG"; do
            docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache/ \
              aquasec/trivy:latest image --severity HIGH,CRITICAL --no-progress --exit-code 0 "$img"
          done
        '''
      }
    }

    stage('Deploy') {
      when { environment name: 'IS_DEPLOY', value: 'true' }
      steps {
        script { env.FAILED_STAGE = env.STAGE_NAME }
        script {
          env.PREV_TAG = sh(script: 'cat "$STATE_DIR/last-good-tag" 2>/dev/null || true', returnStdout: true).trim()
          echo "직전 정상 태그: ${env.PREV_TAG ?: '없음 (첫 배포)'}"
        }

        // 비밀값 env 파일. Jenkins Secret file 크리덴셜을 600 으로 내려놓고 compose env_file 이 읽습니다.
        // 내용은 어떤 단계에서도 출력하지 않습니다 (set +x 는 Jenkins 기본).
        withCredentials([file(credentialsId: 'kkakkung-production-env', variable: 'PROD_ENV_FILE')]) {
          sh 'install -m 600 "$PROD_ENV_FILE" "$STATE_DIR/production.env"'
        }

        sh 'TAG="$TAG" docker compose $COMPOSE up -d'

        // 컨테이너가 떴다고 앱이 산 건 아닙니다. web-proxy 를 거쳐 game-server 의 ready 를 직접 봅니다.
        sh '''
          for i in $(seq 1 30); do
            g=$(docker inspect --format '{{.State.Health.Status}}' kkakkung-game 2>/dev/null || echo none)
            if [ "$g" = "healthy" ] && curl -fsS "$READY_URL" > /dev/null 2>&1; then
              echo "헬스체크 통과 ($i)"; exit 0
            fi
            echo "대기 중... ($i) game=$g"; sleep 3
          done
          echo "헬스체크 실패. 로그:"
          docker logs --tail 60 kkakkung-game || true
          docker logs --tail 30 kkakkung-web  || true
          exit 1
        '''

        // 태그와 함께 이미지 digest 도 기록합니다. 롤백 때 태그가 다른 이미지를 가리키면 멈추기 위해서입니다.
        sh '''
          echo "$TAG" > "$STATE_DIR/last-good-tag"
          {
            echo "game $(docker image inspect --format '{{.Id}}' "$IMG_GAME:$TAG")"
            echo "web  $(docker image inspect --format '{{.Id}}' "$IMG_WEB:$TAG")"
          } > "$STATE_DIR/last-good-digest"
        '''
      }
    }
  }

  post {
    failure {
      updateGitlabCommitStatus name: 'jenkins', state: 'failed'
      // 실패한 사람에게 Mattermost DM. 웹훅 URL 은 Secret text 크리덴셜 mattermost-webhook 에만 있고
      // 로그에 마스킹됩니다. 수신자는 infra/jenkins/notify-map.json (이메일 → MM 사용자명).
      // 알림이 실패해도 빌드 결과는 바뀌지 않습니다.
      script {
        try {
          env.CULPRIT_EMAIL = sh(script: 'git log -1 --format=%ae 2>/dev/null || true', returnStdout: true).trim()
        } catch (ignored) {
          env.CULPRIT_EMAIL = ''
        }
        try {
          withCredentials([string(credentialsId: 'mattermost-webhook', variable: 'MM_WEBHOOK')]) {
            sh 'node scripts/notify-build-failure.mjs || true'
          }
        } catch (ignored) {
          echo 'Mattermost 알림 건너뜀 (크리덴셜 mattermost-webhook 없음 또는 작업공간 없음)'
        }
      }
      script {
        if (env.PREV_TAG?.trim()) {
          echo "배포 실패. ${env.PREV_TAG} 로 롤백합니다"
          // 기록된 digest 와 현재 태그의 이미지가 같을 때만 되돌립니다 (latest 추측 금지).
          sh '''
            want=$(awk '$1=="game"{print $2}' "$STATE_DIR/last-good-digest" 2>/dev/null || true)
            have=$(docker image inspect --format '{{.Id}}' "$IMG_GAME:$PREV_TAG" 2>/dev/null || true)
            if [ -n "$want" ] && [ "$want" != "$have" ]; then
              echo "ROLLBACK_BLOCKED: $IMG_GAME:$PREV_TAG 의 digest 가 기록과 다릅니다. 수동 확인 필요."; exit 0
            fi
            TAG="$PREV_TAG" docker compose $COMPOSE up -d || true
          '''
        }
      }
    }
    success {
      updateGitlabCommitStatus name: 'jenkins', state: 'success'
      // 최근 5개만 남기고 정리. 지금 태그와 직전 정상 태그는 절대 지우지 않습니다.
      sh '''
        keep1="$TAG"; keep2="$(cat "$STATE_DIR/last-good-tag" 2>/dev/null || true)"
        for img in "$IMG_GAME" "$IMG_WEB"; do
          docker images "$img" --format '{{.Tag}}' | grep -v '^<none>$' | tail -n +6 \
            | grep -vx -e "$keep1" -e "${keep2:-__none__}" \
            | xargs -r -I{} docker rmi "$img:{}" || true
        done
      '''
    }
    always {
      sh 'docker image prune -f > /dev/null || true'
    }
  }
}
