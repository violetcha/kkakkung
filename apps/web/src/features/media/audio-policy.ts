// D-16 / ME-06. audio-policy 채널의 검증과 보류.
// 정책 revision과 참조 bindingRevision은 서로 다른 정수다. 같다고 가정하지 않는다.
// AudioPolicy.voices에는 publisherGeneration 필드가 없다. 없는 필드를 읽지 않는다.
import type { BindingStore } from './media-bindings';
import { isSameScope, type MediaScope } from './media-types';

export type AudioVoice = Readonly<{
  playerId: string;
  trackSid: string;
  gain: number;
  azimuthRad: number;
  lowpassHz: number;
}>;

export type AudioEffect = Readonly<{
  eventId: string;
  kind: 'footstep' | 'sensor' | 'trap';
  gain: number;
  azimuthRad: number;
  lowpassHz: number;
  tick: number;
}>;

export type AudioPolicy = MediaScope &
  Readonly<{
    publisherPermissions?: readonly Readonly<{
      participantIdentity: string;
      allowedTrackSids: readonly string[];
    }>[];
    policyRevision: number;
    bindingRevision: number;
    stateVersion: number;
    voices: readonly AudioVoice[];
    effects: readonly AudioEffect[];
  }>;

/** 정책이 바인딩보다 미래이면 최신 1개만 이만큼 보류한다. */
export const FUTURE_POLICY_HOLD_MS = 2000;

export type PolicyApplyResult =
  | Readonly<{ status: 'applied'; policy: AudioPolicy }>
  /** 바인딩이 아직 없어 최신 1개만 보류한다. */
  | Readonly<{ status: 'held'; policy: AudioPolicy }>
  | Readonly<{
      status: 'ignored';
      reason: 'WRONG_SCOPE' | 'STALE_POLICY' | 'PAST_BINDING' | 'MALFORMED';
    }>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVoiceShape(value: unknown): value is AudioVoice {
  if (typeof value !== 'object' || value === null) return false;
  const voice = value as Record<string, unknown>;
  return (
    typeof voice.playerId === 'string' &&
    typeof voice.trackSid === 'string' &&
    voice.trackSid.length > 0 &&
    isFiniteNumber(voice.gain) &&
    isFiniteNumber(voice.azimuthRad) &&
    isFiniteNumber(voice.lowpassHz)
  );
}

function isEffectShape(value: unknown): value is AudioEffect {
  if (typeof value !== 'object' || value === null) return false;
  const effect = value as Record<string, unknown>;
  return (
    typeof effect.eventId === 'string' &&
    effect.eventId.length > 0 &&
    (effect.kind === 'footstep' || effect.kind === 'sensor' || effect.kind === 'trap') &&
    isFiniteNumber(effect.gain) &&
    isFiniteNumber(effect.azimuthRad) &&
    isFiniteNumber(effect.lowpassHz) &&
    isFiniteNumber(effect.tick)
  );
}

export function isPolicyShape(value: unknown): value is AudioPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const policy = value as Record<string, unknown>;
  if (!isFiniteNumber(policy.policyRevision) || !isFiniteNumber(policy.bindingRevision))
    return false;
  if (!isFiniteNumber(policy.stateVersion)) return false;
  if (policy.publisherPermissions !== undefined) {
    const entries = policy.publisherPermissions;
    if (
      !Array.isArray(entries) ||
      entries.length > 5 ||
      !entries.every((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return false;
        const p = entry as Record<string, unknown>;
        return (
          typeof p.participantIdentity === 'string' &&
          p.participantIdentity.length > 0 &&
          Array.isArray(p.allowedTrackSids) &&
          p.allowedTrackSids.length <= 2 &&
          p.allowedTrackSids.every((sid: unknown) => typeof sid === 'string' && sid.length > 0)
        );
      })
    )
      return false;
  }
  if (!Array.isArray(policy.voices) || !policy.voices.every(isVoiceShape)) return false;
  if (!Array.isArray(policy.effects) || !policy.effects.every(isEffectShape)) return false;
  return true;
}

/** 정책이 참조한 bindingRevision에서 실제로 승인된 voice만 남긴다. */
export type ResolvedVoice = AudioVoice &
  Readonly<{ publisherGeneration: number; participantSid: string }>;

export interface PolicyStore {
  apply(policy: AudioPolicy): PolicyApplyResult;
  /** 바인딩이 바뀌었을 때 보류 정책을 다시 본다. */
  revisit(nowMs: number): PolicyApplyResult | null;
  /** 현재 적용된 정책에서 실제 SDK 트랙과 대조 가능한 voice 목록. */
  resolveVoices(): readonly ResolvedVoice[];
  getPolicy(): AudioPolicy | null;
  getEffects(): readonly AudioEffect[];
  reset(): void;
}

export function createPolicyStore(
  bindings: BindingStore,
  holdMs: number = FUTURE_POLICY_HOLD_MS,
): PolicyStore {
  let applied: AudioPolicy | null = null;
  let held: { policy: AudioPolicy; atMs: number } | null = null;

  const scopeMatches = (policy: AudioPolicy): boolean => {
    const scope = bindings.getScope();
    if (!scope) return false;
    return isSameScope(scope, {
      matchId: policy.matchId,
      mediaInstanceId: policy.mediaInstanceId,
      receiverGeneration: policy.receiverGeneration,
    });
  };

  /** policyRevision은 receiverGeneration 안에서만 의미가 있다. 서버는 세대마다 1부터 다시 센다. */
  const sameGeneration = (left: AudioPolicy, right: AudioPolicy): boolean =>
    isSameScope(
      {
        matchId: left.matchId,
        mediaInstanceId: left.mediaInstanceId,
        receiverGeneration: left.receiverGeneration,
      },
      {
        matchId: right.matchId,
        mediaInstanceId: right.mediaInstanceId,
        receiverGeneration: right.receiverGeneration,
      },
    );

  const consider = (policy: AudioPolicy, nowMs: number): PolicyApplyResult => {
    if (!isPolicyShape(policy)) return { status: 'ignored', reason: 'MALFORMED' };
    // 다른 세대의 적용본은 revision 바닥이 되지 않는다. 여기서 applied를 지우지는 않는다.
    // 늦게 도착한 구 세대 정책이 현재 세대의 적용본을 무효로 만들면 안 되기 때문이다.
    const previous = applied && sameGeneration(applied, policy) ? applied : null;
    // 같은 세대에서 같거나 낮은 policyRevision은 중복·과거다.
    if (previous && policy.policyRevision <= previous.policyRevision)
      return { status: 'ignored', reason: 'STALE_POLICY' };
    if (!scopeMatches(policy)) {
      // 바인딩이 아직 없으면 최신 1개만 보류한다. scope가 달라도 여기서 판단할 수 없다.
      if (bindings.getScope() === null) {
        held = { policy, atMs: nowMs };
        return { status: 'held', policy };
      }
      return { status: 'ignored', reason: 'WRONG_SCOPE' };
    }
    const current = bindings.getRevision();
    // 과거 바인딩을 참조하는 정책은 폐기한다.
    if (policy.bindingRevision < current) return { status: 'ignored', reason: 'PAST_BINDING' };
    if (policy.bindingRevision > current) {
      // 미래 정책은 최신 1개만 보류한다.
      held = { policy, atMs: nowMs };
      return { status: 'held', policy };
    }
    applied = policy;
    held = null;
    return { status: 'applied', policy };
  };

  return {
    apply(policy) {
      return consider(policy, 0);
    },

    revisit(nowMs) {
      if (!held) return null;
      if (nowMs - held.atMs > holdMs) {
        held = null;
        return null;
      }
      const pending = held.policy;
      const result = consider(pending, held.atMs);
      if (result.status === 'applied') held = null;
      return result;
    },

    resolveVoices() {
      if (!applied) return [];
      if (applied.bindingRevision !== bindings.getRevision()) return [];
      const remote = bindings.getRemote();
      const resolved: ResolvedVoice[] = [];
      for (const voice of applied.voices) {
        const binding = remote.find((entry) => entry.playerId === voice.playerId);
        if (!binding) continue;
        // voice.trackSid가 현재 검증 바인딩의 audioTrackSid와 같아야 한다.
        if (!binding.audioTrackSid || binding.audioTrackSid !== voice.trackSid) continue;
        resolved.push({
          ...voice,
          publisherGeneration: binding.publisherGeneration,
          participantSid: binding.participantSid,
        });
      }
      return resolved;
    },

    getPolicy: () => applied,
    getEffects: () => applied?.effects ?? [],

    reset() {
      applied = null;
      held = null;
    },
  };
}
