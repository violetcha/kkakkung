import type { FaceConditionNotice } from '../../media/face-condition';

/**
 * S15P21C204-254. 장치 런타임이 낸 얼굴 조건 안내를 그대로 보여 준다. 표시·해제·중복 억제는
 * 런타임이 이미 판단했으므로 여기서 지연을 더 걸지 않는다.
 */
export function FaceGuidanceNotice({ notice }: { notice: FaceConditionNotice | null | undefined }) {
  if (!notice?.message) return null;
  return (
    <p className="face-guidance" role="status" data-condition={notice.condition}>
      {notice.message}
    </p>
  );
}
