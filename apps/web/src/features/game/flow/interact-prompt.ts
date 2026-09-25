// S15P21C204-295. 상호작용 안내. 핫바는 아이템 칸(1~5)만 쓰고, 지금 앞에 있는 것과 하는 행동은
// 여기서 키와 함께 한 줄로 알린다. 판정은 기존 presenter 들이 하고 여기서는 문구만 고른다.
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { exchangePresenter } from '../map/exchange-presenter';
import { exitCandidate, facesExit } from '../pose/challenge-controller';

/** `blocked`: 지금은 그 키가 먹지 않는다. 무엇을 하면 되는지 문구가 말한다(S15P21C204-388). */
export type InteractPrompt = Readonly<{ key: string; label: string; blocked?: true }>;

export function interactPrompt(input: {
  view: PrivateView | null;
  tick: number;
  exchangeTarget?: string | null;
}): InteractPrompt | null {
  const self = input.view?.self;
  if (self?.status !== 'ACTIVE') return null;
  // 도전 중에는 도전 화면이 대신 말한다.
  if (self.challenge) return null;
  const exchange = exchangePresenter(input.view, input.exchangeTarget ?? null, input.tick);
  // 온 요청을 받는 것이 가장 급하다. gesture-intent 의 E 우선순위와 같은 순서다.
  if (exchange?.canAccept) return { key: 'E', label: '지도 교환 수락' };
  const exit = exitCandidate(input.view);
  // S15P21C204-388. 내 출구 앞인데 E 가 먹지 않는 이유를 말한다. 전에는 웹이 명령을 보내지 않고
  // 아무 표시도 없어 "눌러도 안 됨"으로만 보였다. 조건은 product-runtime 의 EXIT_START 거름과 같다.
  if (exit && facesExit(self, exit)) {
    if (self.restraintUntilTick !== null)
      return { key: 'E', label: '구속이 풀리면 탈출 도전', blocked: true };
    if (self.exchange) return { key: 'E', label: '지도 교환을 끝내면 탈출 도전', blocked: true };
    return { key: 'E', label: '탈출 도전' };
  }
  if (exchange?.canRequest) return { key: 'E', label: '지도 교환 요청' };
  if (exit) return { key: 'E', label: '출구 벽을 마주 보면 탈출 도전', blocked: true };
  return null;
}
