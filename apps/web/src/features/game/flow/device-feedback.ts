/** User-facing recovery guidance; device names and raw exception messages stay private. */
export function deviceFeedback(code: string): string {
  const calibration: Record<string, string> = {
    CALIBRATION_NO_FACE:
      '얼굴을 찾지 못했습니다. 얼굴 전체가 밝게 보이도록 정면을 보고 다시 보정해 주세요.',
    CALIBRATION_NO_POSE:
      '상체를 찾지 못했습니다. 얼굴과 양쪽 어깨가 보이도록 카메라에서 조금 떨어져 주세요.',
    CALIBRATION_NOT_ENOUGH_SAMPLES:
      '보정 표본이 부족합니다. 얼굴과 상체가 가려지지 않게 정면을 보고 잠시 유지해 주세요.',
    CALIBRATION_UNSTABLE:
      '보정 중 자세가 크게 흔들렸습니다. 편한 중립 자세에서 잠시 움직임을 멈추고 다시 보정해 주세요.',
  };
  if (calibration[code]) return calibration[code];
  if (code === 'CALIBRATION_WAITING_FOR_MODELS')
    return '얼굴·동작 모델을 불러온 뒤 자세 보정을 시작합니다. 정면을 보고 기다려 주세요.';
  if (
    [
      'MODEL_LOAD_TIMEOUT',
      'MODEL_LOAD_FAILED',
      'MODEL_HASH_MISMATCH',
      'VISION_START_FAILED',
    ].includes(code)
  )
    return '추적 모델을 준비하지 못했습니다. 네트워크 상태를 확인하고 장치를 다시 점검해 주세요.';
  if (code.startsWith('CALIBRATION_'))
    return '얼굴과 양쪽 어깨가 보이도록 정면을 보고 잠시 자세를 유지한 뒤 다시 보정해 주세요.';
  if (
    [
      'DEVICE_LOST',
      'CAMERA_ENDED',
      'DEVICE_NOT_FOUND',
      'DEVICE_IN_USE',
      'PERMISSION_DENIED',
    ].includes(code)
  )
    return '카메라 연결과 브라우저 권한을 확인한 뒤 장치를 다시 연결해 주세요. 경기 중에는 키보드를 사용할 수 있습니다.';
  if (code.startsWith('MICROPHONE_'))
    return '마이크 송출을 확인하지 못했습니다. 마이크를 다시 연결해 주세요. 얼굴 영상과 게임은 계속 사용할 수 있습니다.';
  return '추적을 복구하려면 장치를 다시 점검해 주세요. 보정 후 모션 조작을 직접 선택할 수 있습니다.';
}
