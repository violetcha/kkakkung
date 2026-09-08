#!/usr/bin/env bash
# 비상용 수동 배포. 평소엔 Jenkins 가 합니다.
#
#   ./infra/deploy.sh            현재 커밋으로 빌드 + 배포
#   ./infra/deploy.sh a1b2c3d4   이미 빌드된 태그로 재배포 (롤백)
set -euo pipefail
cd "$(dirname "$0")/.."

TAG="${1:-$(git rev-parse --short=8 HEAD)}"
echo "==> 태그: $TAG"

if ! docker image inspect "kkakkung-game:$TAG" >/dev/null 2>&1; then
  docker build -f infra/docker/Dockerfile.game-server -t "kkakkung-game:$TAG" .
  docker build -f infra/docker/Dockerfile.web         -t "kkakkung-web:$TAG"  .
fi
TAG="$TAG" docker compose -f infra/compose.prod.yaml up -d

echo "==> 헬스체크"
for i in $(seq 1 30); do
  g=$(docker inspect --format '{{.State.Health.Status}}' kkakkung-game 2>/dev/null || echo none)
  if [ "$g" = "healthy" ] && curl -fsS http://127.0.0.1:8080/health/ready >/dev/null 2>&1; then
    echo "OK ($TAG)"; echo "$TAG" > /opt/kkakkung/last-good-tag; exit 0
  fi
  sleep 3
done
echo "실패. 롤백: ./infra/deploy.sh $(cat /opt/kkakkung/last-good-tag 2>/dev/null || echo '<이전SHA>')"
exit 1
