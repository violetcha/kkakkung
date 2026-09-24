/**
 * S15P21C204-372. `GET /api/capacity`: 방을 만들고 경기를 시작할 여유를 개수로만 알린다.
 *
 * 홈 화면이 방 만들기 전에 부른다. 방 코드·참가자·단계는 내보내지 않는다. 입장 시도 한도
 * (`/api/sessions`)와 따로 두어 화면 갱신이 다른 사람의 입장 예산을 쓰지 않게 한다. 로그인 경계는
 * 호스트 nginx 가 다른 API 와 같게 지킨다.
 */
import { Router, type Request, type Response } from 'express';
import { SERVICE_CAPACITY_ROUTE, type ServiceCapacity } from '@kkakkung/protocol/game-messages';
import type { AdmissionState } from './SessionRoutes.js';
import type { SlotRegistry } from './SlotRegistry.js';

export type CapacityRouteDeps = Readonly<{
  slots: SlotRegistry;
  admission: () => AdmissionState;
  /** 월 사용량 가드(S15P21C204-364). 없으면 막지 않는 것으로 본다. */
  canStartMatch?: () => boolean;
  /** 예약만 남은 빈 방을 먼저 정리해 실제보다 차 보이지 않게 한다. */
  cleanupReservations?: () => void;
}>;

export function createCapacityRoutes(deps: CapacityRouteDeps): Router {
  const router = Router();
  router.get(SERVICE_CAPACITY_ROUTE, (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    deps.cleanupReservations?.();
    const capacity = deps.slots.capacity();
    const body: ServiceCapacity = {
      ...capacity,
      admissionOpen: deps.admission() === 'OPEN',
      mediaBlocked: deps.canStartMatch ? !deps.canStartMatch() : false,
    };
    res.json(body);
  });
  return router;
}
