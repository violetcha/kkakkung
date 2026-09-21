// S15P21C204-292. 동의 전에는 어느 경로로도 장치가 켜지지 않는다.
//
// 292 는 장치 점검 화면만 동의로 가렸다. 그런데 방 화면과 개인 체험은 `LocalControls` 를 그
// 화면 **옆에** 함께 그리고, 그 안에 "장치 다시 연결·점검"과 "마이크 연결·재시도"가 있다.
// 그래서 동의 단추가 잠긴 상태에서도 카메라·마이크를 켤 수 있었다.
//
// 그 결함은 "동의 화면이 있는가"를 묻는 시험으로는 잡히지 않는다. 화면을 어떻게 **조립**했는지,
// 그리고 장치를 켜는 길목이 막혀 있는지를 따로 물어야 한다. 여기서 둘 다 고정한다.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalControls } from '../game/flow/LocalControls';
import { createInteractionBridge } from '../../app/interaction-bridge';
import { INITIAL_DEVICES } from '../game/flow/device-readiness';
import { consentGiven, forgetSessionConsent, markConsented, rememberConsent } from './consent';
import type { DeviceStatus, InteractionContext } from '../input/InteractionRuntime';
import type { InteractionRuntime } from '../input/InteractionRuntime';

const RECOVER = '장치 다시 연결·점검';
const MICROPHONE = '마이크 연결·재시도';
const MOTION = '보정 후 모션으로 조작';

const lost: DeviceStatus = { ...INITIAL_DEVICES, camera: 'failed', vision: 'failed' };

function controls(consented: boolean, status: DeviceStatus, variant: 'full' | 'quiet' = 'full') {
  return renderToStaticMarkup(
    createElement(LocalControls, {
      status,
      mode: 'keyboard' as const,
      previewHost: () => {},
      onKeyboard: () => {},
      onMotion: async () => {},
      onRecover: async () => {},
      onMicrophone: async () => {},
      consented,
      variant,
    }),
  );
}

afterEach(forgetSessionConsent);

it('draws no device control beside the device check until the notice is accepted', () => {
  const gated = controls(false, lost);
  for (const label of [RECOVER, MICROPHONE, MOTION]) expect(gated).not.toContain(label);
  // 키보드는 장치를 켜지 않으므로 남는다. 동의하지 않아도 조작은 할 수 있어야 한다.
  expect(gated).toContain('키보드로 조작');
  expect(gated).toContain('개인정보 처리에 동의한 뒤에 켤 수 있습니다');

  const open = controls(true, lost);
  for (const label of [RECOVER, MICROPHONE, MOTION]) expect(open).toContain(label);
});

it('hides the recovery button in the practice-room variant too', () => {
  // 연습방은 조용한 변종을 쓴다. 끊겼을 때만 복구 단추가 나오는데 그것도 장치를 켠다.
  expect(controls(false, lost, 'quiet')).not.toContain(RECOVER);
  expect(controls(true, lost, 'quiet')).toContain(RECOVER);
});

function bridgeWith(consented: () => boolean) {
  const runtime = {
    startDevices: vi.fn(async () => INITIAL_DEVICES),
    setMicrophone: vi.fn(async () => INITIAL_DEVICES),
    calibrate: vi.fn(async () => INITIAL_DEVICES),
    setContext: vi.fn(),
    dispose: vi.fn(async () => {}),
  } as unknown as InteractionRuntime;
  const bridge = createInteractionBridge(
    {
      sendCommand: vi.fn(),
      requestMediaGrant: vi.fn(),
      reportMediaStatus: vi.fn(),
      requestBindingsRefresh: vi.fn(),
      onDeviceStatus: vi.fn(),
      onFaceTrack: vi.fn(),
      onMediaStatus: vi.fn(),
      onSensors: vi.fn(),
      onInteractionState: vi.fn(),
      onLocalPreview: vi.fn(),
    },
    () => runtime,
    consented,
  );
  const context: InteractionContext = {
    matchId: 'm',
    selfPlayerId: 's',
    role: null,
    phase: 'DEVICE_CHECK',
    status: 'ACTIVE',
    mode: 'motion',
    pageActive: true,
  };
  bridge.setContext(context);
  return { bridge, runtime };
}

it('refuses to reach the devices without consent even in a phase that allows them', async () => {
  // 화면을 하나 더 만들어 단추를 다시 새겨도 여기서 막힌다. 화면마다 막는 대신 길목을 막았다.
  const denied = bridgeWith(() => false);
  await denied.bridge.startDevices(true);
  await denied.bridge.updateMicrophone(true);
  expect(denied.runtime.startDevices).not.toHaveBeenCalled();
  expect(denied.runtime.setMicrophone).not.toHaveBeenCalled();
  expect(denied.runtime.calibrate).not.toHaveBeenCalled();
  await denied.bridge.dispose();

  const allowed = bridgeWith(() => true);
  await allowed.bridge.startDevices(true);
  await allowed.bridge.updateMicrophone(true);
  expect(allowed.runtime.startDevices).toHaveBeenCalledOnce();
  expect(allowed.runtime.setMicrophone).toHaveBeenCalledOnce();
  await allowed.bridge.dispose();
});

it('keeps this page usable when the consent could not be stored', () => {
  // 사생활 보호 모드에서는 저장이 던지거나 조용히 실패한다. 그때도 이번 진행은 막지 않는다.
  const blocked = {
    getItem: () => null,
    setItem: () => {
      throw new Error('blocked');
    },
  };
  expect(rememberConsent(blocked, 1)).toBe(false);
  expect(consentGiven(blocked)).toBe(false);
  markConsented();
  expect(consentGiven(blocked)).toBe(true);
});
