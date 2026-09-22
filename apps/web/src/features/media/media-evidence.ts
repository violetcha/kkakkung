// S15P21C204-246 / D3-4. G1·G5·G6 관문이 요구하는 실제 트랙·음성 증거.
//
// 여기서 가장 중요한 것은 **클라이언트 mute와 실제 구독 해제를 섞지 않는 것**이다.
// 사용자가 소리를 껐을 뿐인데 구독은 열려 있는 상태를, 서버가 금지한 수신을 막아 낸 상태로
// 읽으면 정책 위반이 조용히 통과한다. 그래서 두 값을 각각 남기고 판정도 따로 한다.
//
// 이 모듈은 판정기가 아니다. F runner가 읽을 수 있는 모양으로 사실만 모은다.
import type { MediaScope } from './media-types';

export type PublishSourceKind = 'face' | 'microphone';

export type PublishedTrackEvidence = Readonly<{
  source: PublishSourceKind;
  trackSid: string;
  /** B가 확인한 자기 바인딩이 도착했는지. SDK 게시 성공만으로 true가 되지 않는다. */
  serverConfirmed: boolean;
}>;

export type ReceivedTrackEvidence = Readonly<{
  trackSid: string;
  kind: 'video' | 'audio';
  /** 바인딩 대조를 통과한 경우에만 값이 있다. */
  playerId: string | null;
  /** SFU 구독 상태 그대로. 클라이언트 mute와 독립이다. */
  subscribed: boolean;
  /** 검증을 통과해 실제로 출력에 붙었는지. */
  attached: boolean;
  /** 검증 전 보류 중인지. */
  pending: boolean;
  /** 서버 바인딩이 이 SID의 수신을 허용했는지. */
  authorized: boolean;
}>;

export type VoiceEvidence = Readonly<{
  playerId: string;
  trackSid: string;
  /** 오디오 그래프에 실제로 연결됐는지. */
  routed: boolean;
  /** 서버 정책이 준 gain. "정책상 들려야 하는가"이다. */
  policyGain: number;
  /** 사용자 설정까지 반영한 실효 gain. 0이어도 구독은 열려 있을 수 있다. */
  effectiveGain: number;
  /** 사용자가 끈 것인지. 정책 위반과 구분하는 값이다. */
  mutedByUser: boolean;
}>;

/**
 * 구독 무결성 판정. 두 목록의 뜻이 정반대다.
 * - forbiddenButSubscribed: 서버가 허용하지 않은 SID인데 구독이 열려 있다. **위반이다.**
 * - mutedButSubscribed: 사용자가 껐지만 구독은 유지 중이다. **위반이 아니다.**
 */
export type SubscriptionIntegrity = Readonly<{
  forbiddenButSubscribed: readonly string[];
  mutedButSubscribed: readonly string[];
  /** 허용됐는데 구독이 닫혀 있다. 위반은 아니지만 수신 실패의 단서다. */
  authorizedButUnsubscribed: readonly string[];
}>;

export type MediaEvidence = Readonly<{
  scope: MediaScope | null;
  generationState: 'live' | 'terminal' | 'closed';
  published: readonly PublishedTrackEvidence[];
  received: readonly ReceivedTrackEvidence[];
  voices: readonly VoiceEvidence[];
  integrity: SubscriptionIntegrity;
  /** 원격 얼굴 수신 상한. 연습 2, 본 경기 5다. */
  remoteFaceLimit: number;
  /** 실제로 붙은 원격 얼굴 수. 상한을 넘으면 안 된다. */
  attachedFaceCount: number;
}>;

export type EvidenceInput = Readonly<{
  scope: MediaScope | null;
  generationState: 'live' | 'terminal' | 'closed';
  published: readonly PublishedTrackEvidence[];
  /** SDK가 보고하는 실제 구독 상태. D의 의도가 아니라 SDK가 말하는 값이다. */
  subscriptions: readonly Readonly<{
    trackSid: string;
    kind: 'video' | 'audio';
    subscribed: boolean;
  }>[];
  /** 서버 바인딩이 허용한 SID와 그 소유자. */
  authorized: readonly Readonly<{ trackSid: string; playerId: string }>[];
  /** 검증을 통과해 출력에 붙은 얼굴. */
  attachedFaces: readonly Readonly<{ trackSid: string; playerId: string }>[];
  /** 검증 전 보류 중인 SID. */
  pendingSids: readonly string[];
  /** 서버 정책이 정한 목소리. */
  policyVoices: readonly Readonly<{ playerId: string; trackSid: string; gain: number }>[];
  /** 오디오 그래프에 실제로 연결된 SID. */
  routedSids: readonly string[];
  /** 사용자 음향 설정. */
  preferences: Readonly<{ volume: number; muted: boolean; mutedPlayerIds: readonly string[] }>;
  remoteFaceLimit: number;
}>;

function clampGain(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function composeMediaEvidence(input: EvidenceInput): MediaEvidence {
  const authorizedBySid = new Map(
    input.authorized.map((entry) => [entry.trackSid, entry.playerId]),
  );
  const attachedBySid = new Map(
    input.attachedFaces.map((entry) => [entry.trackSid, entry.playerId]),
  );
  const pending = new Set(input.pendingSids);
  const routed = new Set(input.routedSids);
  const mutedPlayers = new Set(input.preferences.mutedPlayerIds);

  const received: ReceivedTrackEvidence[] = input.subscriptions.map((entry) => ({
    trackSid: entry.trackSid,
    kind: entry.kind,
    playerId: authorizedBySid.get(entry.trackSid) ?? null,
    subscribed: entry.subscribed,
    attached: attachedBySid.has(entry.trackSid),
    pending: pending.has(entry.trackSid),
    authorized: authorizedBySid.has(entry.trackSid),
  }));

  const voices: VoiceEvidence[] = input.policyVoices.map((voice) => {
    const mutedByUser = input.preferences.muted || mutedPlayers.has(voice.playerId);
    const policyGain = clampGain(voice.gain);
    return {
      playerId: voice.playerId,
      trackSid: voice.trackSid,
      routed: routed.has(voice.trackSid),
      policyGain,
      // 사용자가 끄면 0이 되지만 정책 gain 은 그대로 남는다. 둘을 함께 남기는 것이 요점이다.
      effectiveGain: mutedByUser ? 0 : clampGain(policyGain * input.preferences.volume),
      mutedByUser,
    };
  });

  const forbiddenButSubscribed = received
    .filter((entry) => entry.subscribed && !entry.authorized)
    .map((entry) => entry.trackSid);
  const authorizedButUnsubscribed = received
    .filter((entry) => !entry.subscribed && entry.authorized)
    .map((entry) => entry.trackSid);
  // 구독은 열려 있는데 사용자가 껐을 뿐인 경우. 위반 목록과 절대 합치지 않는다.
  const mutedButSubscribed = voices
    .filter(
      (voice) =>
        voice.mutedByUser &&
        received.some((entry) => entry.trackSid === voice.trackSid && entry.subscribed),
    )
    .map((voice) => voice.trackSid);

  return {
    scope: input.scope,
    generationState: input.generationState,
    published: input.published,
    received,
    voices,
    integrity: {
      forbiddenButSubscribed,
      mutedButSubscribed,
      authorizedButUnsubscribed,
    },
    remoteFaceLimit: input.remoteFaceLimit,
    attachedFaceCount: input.attachedFaces.length,
  };
}
