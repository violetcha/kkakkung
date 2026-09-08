// 까꿍 CI/CD
//
// 서버 한 대. 컨트롤러에서 바로 빌드하고 같은 호스트에 배포합니다.
// 레지스트리는 두지 않고 커밋 SHA 태그만 유지합니다. 롤백은 이전 태그로 compose up.
// 검증 명령은 저장소의 pnpm 스크립트(CONTRIBUTING.md)를 그대로 씁니다.

pipeline {
  agent any

  options {
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
    // .node-version / package.json engines 와 같은 버전. 여기 바꾸면 Dockerfile 도 같이.
    NODE_IMAGE = 'node:24.19.0-bookworm-slim'
    PNPM_VER   = '11.19.0'
    // 호스트 도구 없이 컨테이너 안에서 pnpm 실행. jenkins uid 로 돌려 root 소유 파일이 안 남게.
    // pnpm store 는 호스트의 jenkins 홈에 캐시 (첫 빌드 이후 install 이 빨라짐).
    RUN_NODE  = 'docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -e CI=true -e npm_config_prefix=/tmp/npm -v /var/lib/jenkins/.cache/pnpm-store:/tmp/pnpm-store'
  }

  stages {

    stage('Prepare') {
      steps {
        script {
          env.TAG = sh(script: 'git rev-parse --short=8 HEAD', returnStdout: true).trim()
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
      }
    }

    stage('Secret scan') {
      steps {
        sh '''
          docker run --rm -v "$WORKSPACE:/repo" zricethezav/gitleaks:latest \
            detect --source=/repo --no-banner --redact --exit-code 1
        '''
      }
    }

    stage('Verify') {
      steps {
        // CONTRIBUTING.md 의 검사 순서 그대로. e2e(Playwright, Chromium 필요)만 아직 제외 → 브라우저 이미지 붙여 추가 예정.
        // check:execution 은 실행계획 문서·계약·fixture 동기 검사 (F 소유, 루트 node_modules 만 필요).
        sh '''
          $RUN_NODE -v "$WORKSPACE:/workspace" -w /workspace "$NODE_IMAGE" sh -c '
            set -e
            npm install -g pnpm@'"$PNPM_VER"' > /dev/null
            export PATH=/tmp/npm/bin:$PATH
            pnpm config set store-dir /tmp/pnpm-store
            pnpm install --frozen-lockfile
            pnpm format:check
            pnpm check:execution
            pnpm lint
            pnpm typecheck
            pnpm test
          '
        '''
      }
    }

    stage('Build images') {
      steps {
        // 컨텍스트는 저장소 루트 (workspace 패키지 의존). 루트 .dockerignore 가 node_modules/dist 를 걸러줍니다.
        sh '''
          docker build -f infra/docker/Dockerfile.game-server -t "$IMG_GAME:$TAG" .
          docker build -f infra/docker/Dockerfile.web         -t "$IMG_WEB:$TAG"  .
        '''
      }
    }

    stage('Scan images') {
      steps {
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
