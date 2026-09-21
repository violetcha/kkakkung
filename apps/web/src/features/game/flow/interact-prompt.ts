// S15P21C204-295. 상호작용 안내. 핫바는 아이템 칸(1~5)만 쓰고, 지금 앞에 있는 것과 하는 행동은
// 여기서 키와 함께 한 줄로 알린다. 판정은 기존 presenter 들이 하고 여기서는 문구만 고른다.
import type { PrivateView } from '@kkakkung/protocol/game-schema';
import { exchangePresenter } from '../map/exchange-presenter';
import { exitCandidate, facesExit } from '../pose/challenge-controller';

export type InteractPrompt = Readonly<{ key: string; label: string }>;

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
  if (exit && facesExit(self, exit)) return { key: 'E', label: '탈출 도전' };
  if (exchange?.canRequest) return { key: 'E', label: '지도 교환 요청' };
  return null;
}
