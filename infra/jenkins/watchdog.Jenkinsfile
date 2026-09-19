// S15P21C204-288. 배포 호스트 밖에서 본 서비스 생존 감시. 5분마다 scripts/watch-service.mjs 가
// kkakkung-game·kkakkung-web 컨테이너와 127.0.0.1:8080/health/live 를 확인하고, 무응답·비정상 재시작·
// 복구가 생길 때만 Mattermost 로 한 번 알린다. 상태는 $STATE_DIR/watchdog-state.json.
// 잡 만들기와 첫 실행은 infra/jenkins/SETUP.md 11장.
pipeline {
  agent any

  triggers { cron('H/5 * * * *') }

  options {
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '50'))
    timeout(time: 3, unit: 'MINUTES')
    timestamps()
  }

  parameters {
    booleanParam(name: 'SEND_TEST', defaultValue: false, description: '시험 메시지 한 번만 보내고 끝낸다')
  }

  environment {
    STATE_DIR = '/opt/kkakkung'
  }

  stages {
    stage('Watch') {
      steps {
        withCredentials([string(credentialsId: 'mattermost-webhook', variable: 'MM_WEBHOOK')]) {
          script {
            if (params.SEND_TEST) {
              sh 'node scripts/watch-service.mjs --test'
            } else {
              sh 'node scripts/watch-service.mjs --state "$STATE_DIR/watchdog-state.json"'
            }
          }
        }
      }
    }
  }
}
