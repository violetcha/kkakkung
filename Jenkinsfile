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

  parameters {
    choice(name: 'RELEASE_PROFILE', choices: ['product', 'skeleton'], description: 'product: 승인된 Cloud/운영 증거와 6인 smoke를 검사한 뒤 배포')
  }

  options {
    // GitLab 커밋 상태 게시 (Jenkins 관리 → System → GitLab connection 'ssafy-gitlab', 크리덴셜 gitlab-api-token)
    gitLabConnection('ssafy-gitlab')
    timestamps()
    // 같은 잡 안의 동시 실행 금지. 잡 사이(kkakkung ↔ kkakkung-mr)의 겹침은 Verify 단계의 호스트
    // flock 으로만 막는다 (infra/jenkins/SETUP.md §6). 2026-09-10 두 빌드의 vitest 가 겹쳐 4 vCPU 가
    // 모자라 tick 250ms 초과로 product-integration 시험이 깨진 뒤 정한 규칙.
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
    // product: private environment, approved runtime evidence and DP-06 preflight are required.
    DEPLOY_PROFILE = "${params.RELEASE_PROFILE ?: 'product'}"
    // 검증 도구체인은 infra/docker/Dockerfile.ci (Node 24.19.0 + pnpm 11.19.0 + Playwright Chromium).
    // 파일 해시로 태그해서 Dockerfile.ci 가 바뀔 때만 다시 빌드합니다.
    CI_IMAGE   = 'kkakkung-ci'
    // 검사 도구는 태그를 고정합니다. :latest 는 원격이 움직일 때마다 다시 받고, 어떤 판정으로
    // 통과했는지 나중에 되짚을 수 없습니다. 올릴 때는 이 줄만 바꿉니다 (S15P21C204-322).
    GITLEAKS_IMAGE = 'zricethezav/gitleaks:v8.30.1'
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
        // 이 빌드가 이미지를 만들어야 하는지, 비밀 스캔이 어디부터 읽으면 되는지 (S15P21C204-322).
        // 판단은 두 스크립트가 하고 여기서는 결과만 받습니다. 둘 다 "모르겠으면 전부 한다" 쪽으로
        // 답하므로, 판단이 실패해도 검사가 느슨해지지 않습니다.
        script {
          env.NEEDS_IMAGES = sh(
            script: 'node scripts/needs-image-build.mjs --deploy "$IS_DEPLOY" --base origin/develop',
            returnStdout: true).trim()
          // MR 은 develop 이후의 커밋만, 배포는 마지막 정상 배포 이후만 읽으면 됩니다.
          def scanBase = env.IS_DEPLOY == 'true'
            ? sh(script: 'cat "$STATE_DIR/last-good-tag" 2>/dev/null || true', returnStdout: true).trim()
            : 'origin/develop'
          withEnv(["SCAN_BASE=${scanBase}"]) {
            env.SCAN_RANGE = sh(
              script: 'node scripts/secret-scan-range.mjs "$SCAN_BASE"', returnStdout: true).trim()
          }
          echo "images=${env.NEEDS_IMAGES}  secret-scan=${env.SCAN_RANGE ?: '전체 히스토리'}"
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
        // 범위는 Prepare 가 정합니다. 비어 있으면 전체 히스토리를 읽습니다.
        sh '''
          if [ -n "$SCAN_RANGE" ]; then
            echo "비밀 스캔 범위: $SCAN_RANGE"
            set -- "--log-opts=$SCAN_RANGE"
          else
            echo "비밀 스캔: 전체 히스토리 (기준 커밋을 찾지 못했습니다)"
            set --
          fi
          docker run --rm -v "$WORKSPACE:/repo" "$GITLEAKS_IMAGE" \
            detect --source=/repo --no-banner --redact --exit-code 1 "$@"
        '''
      }
    }

    stage('Verify') {
      steps {
        script { env.FAILED_STAGE = env.STAGE_NAME }
        // 단일 진입점 scripts/ci-verify.mjs: 도구체인 확인 → EXPECTED_SOURCE_SHA 대조 → frozen install
        // → Chromium 확인 → pnpm verify 를 정확히 한 번 (format·lint·typecheck·test·build·e2e).
        // 개별 pnpm 검사 목록을 여기 다시 나열하지 않습니다 (DP-04).
        // jenkins uid 로 돌려 root 소유 파일이 안 남게 하고, pnpm store 는 호스트 jenkins 홈에 캐시합니다.
        //
        // 시간 (2026-09-14): 이 단계가 빌드의 7~8분을 차지합니다.
        // - 같은 소스 트리를 이미 검증했으면 어느 잡이든 검증을 생략합니다. 키는 git tree 해시입니다.
        //   MR 빌드는 소스 브랜치를 그대로 체크아웃하므로(머지 결과가 아니라) 다른 MR 이 머지돼
        //   develop 이 움직여도 이 트리는 달라지지 않습니다. 그때 GitLab 이 열린 MR 을 다시
        //   트리거하면 예전에는 같은 트리를 9~10분씩 다시 검증했고, 새로 얻는 정보가 없었습니다
        //   (kkakkung-mr #237~#245 실측). 트리가 조금이라도 다르면 여전히 전부 검증합니다.
        // - Verify·이미지 빌드·배포는 같은 호스트 flock 을 잡아 한 번에 하나만 돕니다. 다른 빌드의
        //   vitest 와 CPU 를 나누면 tick 250ms 판정이 깨져 flake 가 났기 때문입니다(kkakkung-mr #70, #139).
        //   체크아웃·비밀 스캔 같은 가벼운 단계만 겹칩니다.
        script {
          env.TREE_SHA = sh(script: 'git rev-parse HEAD^{tree}', returnStdout: true).trim()
          env.VERIFIED_BY = sh(script: 'node scripts/verified-tree.mjs check --state-dir "$STATE_DIR" --tree "$TREE_SHA"', returnStdout: true).trim()
        }
        sh '''
          if [ -n "$VERIFIED_BY" ]; then
            echo "Verify 생략: 동일 트리 $TREE_SHA 는 $VERIFIED_BY 가 검증했습니다"
            exit 0
          fi
          # 호스트 상태를 앞뒤로 남긴다. t3.xlarge 는 CPU 크레딧이 바닥나면 steal 이 치솟아 SwiftShader e2e 가
          # 60초 예산을 넘긴다(kkakkung-mr #171). 실패 로그에서 "느린 호스트" 와 "느린 코드" 를 구분하는 근거.
          host_state() { echo "host $1: load=$(cut -d' ' -f1-3 /proc/loadavg) steal_ticks=$(awk '/^cpu /{print $9}' /proc/stat) idle_ticks=$(awk '/^cpu /{print $5}' /proc/stat)"; }
          host_state before-verify
          flock /var/lib/jenkins/verify.lock \
            docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e CI=true -e EXPECTED_SOURCE_SHA="$EXPECTED_SOURCE_SHA"             -e npm_config_prefix=/tmp/npm -e PNPM_HOME=/tmp/pnpm -e npm_config_store_dir=/tmp/pnpm-store             -v /var/lib/jenkins/.cache/pnpm-store:/tmp/pnpm-store             -v "$WORKSPACE:/workspace" -w /workspace "$CI_IMAGE:$CI_TAG"             node scripts/ci-verify.mjs
          host_state after-verify
          node scripts/verified-tree.mjs record --state-dir "$STATE_DIR" --tree "$TREE_SHA" --commit "$GIT_SHA" --build "$JOB_NAME#$BUILD_NUMBER"
        '''
      }
    }

    // 배포 빌드는 항상, MR 빌드는 이미지에 들어가는 파일을 건드렸을 때만 (S15P21C204-322).
    // MR 이미지는 Deploy 를 건너뛰어 아무도 쓰지 않고, 태그가 커밋 SHA 라서 머지 커밋이 재사용하지도
    // 못했습니다. 소스가 깨지는 것은 Verify 의 `pnpm build` 가 이미 잡고, 여기서 더 보는 것은
    // Dockerfile 과 그것이 COPY·install 하는 것들뿐입니다.
    stage('Build images') {
      when { environment name: 'NEEDS_IMAGES', value: 'true' }
      steps {
        script { env.FAILED_STAGE = env.STAGE_NAME }
        // 컨텍스트는 저장소 루트 (workspace 패키지 의존). 루트 .dockerignore 가 node_modules/dist 를 걸러줍니다.
        sh '''
          # 무거운 단계 잠금: 다른 빌드의 vitest(250ms tick 판정)와 CPU 를 나누지 않는다 (SETUP.md §6).
          exec 9>/var/lib/jenkins/verify.lock; flock 9
          node scripts/build-release-images.mjs "$GIT_SHA"
        '''
      }
    }

    stage('Deploy') {
      when { environment name: 'IS_DEPLOY', value: 'true' }
      steps {
        script { env.FAILED_STAGE = env.STAGE_NAME }

        // Check all inputs before replacing the runtime env or touching containers.
        script {
          withCredentials([file(credentialsId: 'kkakkung-production-env', variable: 'PROD_ENV_FILE')]) {
            if (env.DEPLOY_PROFILE == 'product') {
              sh '''
                exec 9>/var/lib/jenkins/verify.lock; flock 9
                set +x
                node --import tsx scripts/product-release.mjs --check-only --env-file "$PROD_ENV_FILE" \
                  --evidence-dir "$STATE_DIR/runtime-evidence" --preflight "$STATE_DIR/cloud-preflight.json" \
                  --sha "$GIT_SHA" --base-url "$PUBLIC_URL" --state-dir "$STATE_DIR"
                install -m 600 "$PROD_ENV_FILE" "$STATE_DIR/production.env"
                node --import tsx scripts/product-release.mjs --env-file "$STATE_DIR/production.env" \
                  --evidence-dir "$STATE_DIR/runtime-evidence" --preflight "$STATE_DIR/cloud-preflight.json" \
                  --sha "$GIT_SHA" --base-url "$PUBLIC_URL" --state-dir "$STATE_DIR"
              '''
            } else {
              sh '''
                exec 9>/var/lib/jenkins/verify.lock; flock 9
                install -m 600 "$PROD_ENV_FILE" "$STATE_DIR/production.env"
                node scripts/verify-release.mjs --sha "$GIT_SHA" --tag "$TAG" --verified-sha "$GIT_SHA" \
                  --profile skeleton --state-dir "$STATE_DIR" --output "$STATE_DIR/releases/$TAG.json"
                node --import tsx scripts/deploy-release.mjs --manifest "$STATE_DIR/releases/$TAG.json" \
                  --evidence "$STATE_DIR/releases/$TAG" --base-url "$PUBLIC_URL" --state-dir "$STATE_DIR"
              '''
            }
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
      // 최근 5개만 남기고 정리. 지금 태그·직전 정상 태그·실행 중 컨테이너의 태그, 그리고 마지막으로 태그가
      // 붙은 지 1시간이 안 된 태그는 지우지 않습니다. 다른 빌드가 막 만든 태그를 지우면 그 빌드의 Trivy 가
      // 깨집니다 (kkakkung #140 ↔ kkakkung-mr #167). 정리도 같은 호스트 flock 아래에서 돕니다 (SETUP.md §6).
      sh '''
        flock /var/lib/jenkins/verify.lock node scripts/prune-release-images.mjs \
          --keep 5 --min-age-minutes 60 \
          --protect "$TAG" --protect "$(cat "$STATE_DIR/last-good-tag" 2>/dev/null || true)" \
          "$IMG_GAME" "$IMG_WEB" || true
      '''
    }
    always {
      sh 'docker image prune -f > /dev/null || true'
    }
  }
}
