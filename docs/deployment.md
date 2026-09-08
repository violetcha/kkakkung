# 배포

현재 스켈레톤은 로컬 개발 전용이다. `MEDIA_MODE=disabled`만 지원하며 실제 인증, LiveKit 미디어, 지속 저널, 사용량 예산, 이전 세대 복구가 구현되기 전에는 production 시작을 차단한다.

목표 배포는 같은 커밋에서 빌드한 정적 web-proxy와 Node game-server 두 컨테이너다. 공개 80/443에서 HTTPS/WSS를 제공하고 Node 포트는 내부 네트워크에 둔다. health는 프로세스 생존(`/health/live`)과 입장 가능(`/health/ready`)을 분리한다.

현재 Docker 개발 템플릿은 루트에서 다음 명령으로 구성한다.

```bash
docker compose -f infra/compose.yaml up --build
```

작성 환경에서는 Docker daemon이 실행 중이지 않아 실제 이미지 빌드와 컨테이너 런타임을 검증하지 않았다.

개발 Compose의 Nginx는 React/API/WebSocket 외에 기존 서버 도구의 `/health`, `/monitor`, `/playground`와 각 하위 자산 경로를 game-server로 전달한다. 직접 서버 도구를 열 때 허용 Origin은 로컬 `localhost:2567`과 `127.0.0.1:2567`을 포함한다. 이 노출은 개발 profile 전용이다.

운영 전에는 G1~G6 증거, 실제 Secret 주입, 지속 운영 볼륨, Nginx WebSocket 프록시, 6인 smoke와 롤백 절차가 필요하다. 현재 infra 템플릿이나 로컬 health 성공을 배포 준비 완료로 보지 않는다.
