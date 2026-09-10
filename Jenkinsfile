// 까꿍 CI/CD
//
// 서버 한 대. 컨트롤러에서 바로 빌드하고 같은 호스트에 배포합니다.
// 레지스트리는 두지 않고 커밋 SHA 태그만 유지합니다.
// 검증 명령은 저장소의 pnpm 스크립트(CONTRIBUTING.md)를 그대로 씁니다.
// 배포·롤백은 scripts/deploy-release.mjs 하나가 합니다 (DP-06): 격리 확인 → drain → 교체 → ready/복구
// → resume → smoke → 공개 재검사 → last-good 기록. 실패는 같은 장벽으로 이전 이미지에 복귀하고,
// 확인이 안 되면 ROLLBACK_BLOCKED 로 남깁니다. 여기서 compose 를 직접 부르지 않습니다.

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
    STATE_DIR = '/opt/kkakkung'
    PUBLIC_URL = 'https://j15c204.p.ssafy.io'
    DEPLOY_BRANCH = 'develop'
    // skeleton: E 운영 API(/api/operations, OPS_TOKEN) 미통합 상태. drain/resume 없이 ready + HTTP smoke 까지만.
    // product: 크리덴셜 kkakkung-ops-token(Secret text) 과 DP-06 preflight 가 필요. 전환은 infra/jenkins/SETUP.md §10.
    DEPLOY_PROFILE = 'skeleton'
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

        // 비밀값 env 파일. Jenkins Secret file 크리덴셜을 600 으로 내려놓고 compose env_file 이 읽습니다.
        // 내용은 어떤 단계에서도 출력하지 않습니다 (set +x 는 Jenkins 기본).
        withCredentials([file(credentialsId: 'kkakkung-production-env', variable: 'PROD_ENV_FILE')]) {
          sh 'install -m 600 "$PROD_ENV_FILE" "$STATE_DIR/production.env"'
        }

        // 1) 매니페스트: 이 빌드가 검증한 커밋(GIT_SHA)과 방금 만든 두 이미지의 digest·revision 라벨, 이전 last-good.
        //    이미지가 없거나 라벨이 다르면 여기서 멈춥니다 (태그로 커밋을 추정하지 않음).
        sh '''
          mkdir -p "$STATE_DIR/releases"
          node scripts/verify-release.mjs --sha "$GIT_SHA" --tag "$TAG" --verified-sha "$GIT_SHA"             --profile "$DEPLOY_PROFILE" --state-dir "$STATE_DIR" --output "$STATE_DIR/releases/$TAG.json"
        '''

        // 2) 장벽 실행. 운영 토큰은 product 프로파일에서만 Secret text 로 바인딩합니다 (로그 마스킹).
        //    결과·단계는 $STATE_DIR/releases/$TAG/release.json 에 남고, 종료 코드가 빌드 결과입니다.
        script {
          def run = 'node scripts/deploy-release.mjs --manifest "$STATE_DIR/releases/$TAG.json" ' +
                    '--evidence "$STATE_DIR/releases/$TAG" --base-url "$PUBLIC_URL" --state-dir "$STATE_DIR"'
          if (env.DEPLOY_PROFILE == 'product') {
            withCredentials([string(credentialsId: 'kkakkung-ops-token', variable: 'OPS_TOKEN')]) {
              sh run + ' --preflight "$STATE_DIR/cloud-preflight.json"'
            }
          } else {
            sh run
          }
        }
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
      // 롤백은 deploy-release.mjs 가 이미 시도했습니다. 기록만 보여줍니다 (ROLLBACK_BLOCKED 면 사람이 확인).
      sh '''
        f="$STATE_DIR/releases/$TAG/release.json"
        if [ -f "$f" ]; then
          echo "release phase/result:"; node -e 'const r=require(process.argv[1]);console.log(r.phase, r.result, r.reason||"", r.detail||"")' "$f" || true
        fi
      '''
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
