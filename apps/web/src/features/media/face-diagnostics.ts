// S15P21C204-407. 경기 중 원격 얼굴이 회색 판으로만 남는 원인을 가르는 진단 기록. 팀 연습에서는 붙는데
// 경기에서만 안 붙어, 끊기는 단계(바인딩 · 트랙 · 보이는 사람 · 텍스처)를 한 판으로 알아야 한다.
//
// 참가자 ID 는 앞 8자만 남긴다(적은 서버 별칭이다). 이름·영상·토큰은 남기지 않는다. 같은 줄이 이어지면
// 한 번만 찍어, 초당 여러 번 오는 뷰 갱신으로 콘솔이 넘치지 않게 한다.

export type FaceDiagnostics = Readonly<{
  bindings(input: {
    phase: string | null;
    revision: number;
    outcome: 'applied' | 'wrong-scope' | 'stale' | 'not-participating' | 'other-match';
    remote: readonly { playerId: string; face: boolean }[];
  }): void;
  track(input: { playerId: string; attached: boolean; accepted: boolean }): void;
  visible(phase: string | null, ids: readonly string[]): void;
  bound(ids: readonly string[]): void;
}>;

const short = (id: string) => id.slice(0, 8);

export function createFaceDiagnostics(
  log: (...args: unknown[]) => void = (...args) => console.info(...args),
): FaceDiagnostics {
  const last = new Map<string, string>();
  const emit = (kind: string, line: string) => {
    if (last.get(kind) === line) return;
    last.set(kind, line);
    try {
      log(`[kkakkung] 얼굴 진단 ${kind}: ${line}`);
    } catch {
      /* Diagnostics never affect the game. */
    }
  };
  return {
    bindings({ phase, revision, outcome, remote }) {
      const list = remote.map((r) => `${short(r.playerId)}${r.face ? '+얼굴' : '-얼굴없음'}`);
      emit('바인딩', `phase=${phase} rev=${revision} ${outcome} [${list.join(', ')}]`);
    },
    track({ playerId, attached, accepted }) {
      emit(
        `트랙 ${short(playerId)}`,
        `${attached ? '붙음' : '떨어짐'} ${accepted ? '받아들임' : '버림(범위 불일치 등)'}`,
      );
    },
    visible(phase, ids) {
      emit('보이는 사람', `phase=${phase} [${ids.map(short).join(', ')}]`);
    },
    bound(ids) {
      emit('얼굴 텍스처', `[${ids.map(short).join(', ')}]`);
    },
  };
}
