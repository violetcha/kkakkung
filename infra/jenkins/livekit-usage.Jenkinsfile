// S15P21C204-304. Provider-side usage check; this job does not run inside kkakkung-game.
pipeline {
  agent any

  triggers { cron('H/30 * * * *') }

  options {
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '50'))
    timeout(time: 5, unit: 'MINUTES')
    timestamps()
  }

  parameters {
    booleanParam(name: 'SEND_TEST', defaultValue: false, description: '시험 메시지 한 번만 보내고 끝낸다')
  }

  environment {
    STATE_DIR = '/opt/kkakkung'
    // Confirm these three values against LiveKit Cloud Settings → Project before enabling.
    LIVEKIT_PARTICIPANT_MINUTES_ALLOWANCE = '5000'
    LIVEKIT_PARTICIPANT_MINUTES_WARNING = '4000'
    LIVEKIT_PARTICIPANT_MINUTES_CRITICAL = '4500'
  }

  stages {
    stage('Check LiveKit usage') {
      steps {
        withCredentials([
          string(credentialsId: 'livekit-api-key', variable: 'LIVEKIT_API_KEY'),
          string(credentialsId: 'livekit-api-secret', variable: 'LIVEKIT_API_SECRET'),
          string(credentialsId: 'livekit-project-id', variable: 'LIVEKIT_PROJECT_ID'),
          string(credentialsId: 'livekit-usage-baseline-minutes', variable: 'LIVEKIT_USAGE_BASELINE_MINUTES'),
          string(credentialsId: 'mattermost-webhook', variable: 'MM_WEBHOOK'),
        ]) {
          script {
            if (params.SEND_TEST) {
              sh 'node scripts/check-livekit-usage.mjs --test'
            } else {
              sh 'node scripts/check-livekit-usage.mjs --state "$STATE_DIR/livekit-usage-state.json"'
            }
          }
        }
      }
    }
  }
}
