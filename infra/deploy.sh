#!/usr/bin/env bash
# 비상용 수동 배포·롤백. 평소엔 Jenkins 가 같은 러너를 호출합니다 (DP-06).
#
#   ./infra/deploy.sh <커밋SHA>            Jenkins 가 검증·빌드한 그 커밋의 이미지로 배포
#   ./infra/deploy.sh <이전SHA>            이전 태그로 복귀 (같은 장벽을 다시 통과)
#
# 현재 체크아웃을 빌드하지 않습니다. 이미지가 없으면 그 커밋을 Jenkins 로 검증·빌드해야 합니다.
# 운영 API 토큰은 OPS_TOKEN 환경변수로만 받고 출력하지 않습니다 (product 프로파일에서 필수).
# 프로파일: DEPLOY_PROFILE=skeleton(기본, E 운영 API 미통합) | product(drain→resume→smoke→공개 재검사).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
  echo "사용법: ./infra/deploy.sh <커밋SHA(전체 또는 8자리)>"; exit 2
fi
SHA="$(git rev-parse --verify "$1^{commit}")"
TAG="${SHA:0:8}"
STATE_DIR=/opt/kkakkung
PROFILE="${DEPLOY_PROFILE:-skeleton}"
BASE_URL="${DEPLOY_BASE_URL:-https://j15c204.p.ssafy.io}"
ENV_FILE="$STATE_DIR/production.env"
if [ ! -s "$ENV_FILE" ]; then
  echo "비밀값 파일이 없습니다: $ENV_FILE  (infra/production.env.example 참고, Jenkins 크리덴셜 kkakkung-production-env 에서 내려받음)"; exit 1
fi
echo "==> 커밋 $SHA (태그 $TAG), 프로파일 $PROFILE"

mkdir -p "$STATE_DIR/releases"
if [ "$PROFILE" = product ]; then
  exec node --import tsx scripts/product-release.mjs --env-file "$ENV_FILE" \
    --evidence-dir "$STATE_DIR/runtime-evidence" \
    --preflight "${DEPLOY_PREFLIGHT:-$STATE_DIR/cloud-preflight.json}" \
    --sha "$SHA" --base-url "$BASE_URL" --state-dir "$STATE_DIR"
fi
if [ "$PROFILE" != skeleton ]; then echo "알 수 없는 배포 프로파일"; exit 2; fi
# 검증 SHA = 요청 SHA. 수동 경로도 Jenkins 가 만든 이미지만 쓰므로 라벨 대조로 확인됩니다.
node scripts/verify-release.mjs --sha "$SHA" --tag "$TAG" --verified-sha "$SHA" \
  --profile "$PROFILE" --state-dir "$STATE_DIR" --output "$STATE_DIR/releases/$TAG.json"

PREFLIGHT_ARGS=()
if [ -n "${DEPLOY_PREFLIGHT:-}" ]; then PREFLIGHT_ARGS=(--preflight "$DEPLOY_PREFLIGHT"); fi
node --import tsx scripts/deploy-release.mjs --manifest "$STATE_DIR/releases/$TAG.json" \
  --evidence "$STATE_DIR/releases/$TAG" --base-url "$BASE_URL" --state-dir "$STATE_DIR" "${PREFLIGHT_ARGS[@]}"
