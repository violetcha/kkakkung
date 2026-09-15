// S15P21C204-224 / W13. 장치를 켜기 전에 보여주는 개인정보 처리 안내.
// 각 문장은 아래 evidence의 실제 코드 경로와 1:1로 대조한 사실만 담는다.
// 가공 얼굴을 "익명화"로 소개하지 않고, 서비스 녹화 기능이 없다는 사실을
// 상대 단말의 녹화 불가능으로 설명하지 않는다. 문의 경로는 실제 담당·주소가
// 정해지지 않아 넣지 않는다(임의 작성 금지).

export interface PrivacyNoticeSentence {
  /** 사용자에게 보이는 문장. */
  readonly text: string;
  /** 문장을 뒷받침하는 저장소 코드 경로. 문구를 바꾸면 함께 대조한다. */
  readonly evidence: readonly string[];
}

export const PRIVACY_NOTICE: readonly PrivacyNoticeSentence[] = [
  {
    // 카메라 프레임은 기기 안 Worker에서만 추론되고(vision.worker), 얼굴 좌표는
    // 서버 프로토콜에 없다(product.ts command union). 게시는 얼굴 윤곽 마스크를
    // 흑백 160×160으로 가공한 캔버스만 허용하고 원본 트랙은 거부한다.
    // 얼굴을 잃으면 코드 생성 기본 얼굴로 바꾼다(safe-face).
    text: '카메라 영상은 이 기기 안에서 처리됩니다. 얼굴 윤곽만 잘라 흑백 저해상도로 가공한 얼굴만 전송되고, 원본 카메라 영상과 얼굴 좌표는 전송되지 않습니다. 얼굴을 찾지 못하면 기본 얼굴로 바뀝니다.',
    evidence: [
      'apps/web/src/features/vision/vision.worker.ts',
      'packages/protocol/src/game-messages/product.ts',
      'apps/web/src/features/media/face-mask.ts',
      'apps/web/src/features/media/face-compositor.ts',
      'apps/web/src/features/media/track-publisher.ts',
      'apps/web/src/features/media/safe-face.ts',
    ],
  },
  {
    // 마이크는 별도 요청으로만 켜지고(device-manager), 켜면 원본 오디오 트랙을
    // 그대로 게시한다(publishMicrophone). 얼굴·음성은 LiveKit SFU를 거쳐 서버가
    // 허용한 같은 방 참가자에게만 전달된다(autoSubscribe false, 서버 허용 목록).
    text: '가공한 얼굴과, 마이크를 켠 경우 음성은 미디어 중계 서버를 거쳐 같은 방 참가자에게만 전달됩니다. 음성은 가공하지 않고 그대로 전달됩니다.',
    evidence: [
      'apps/web/src/features/devices/device-manager.ts',
      'apps/web/src/features/media/track-publisher.ts',
      'apps/web/src/features/media/livekit-adapter.ts',
      'server/src/media/LiveKitGateway.ts',
    ],
  },
  {
    // 검증 전 트랙은 attach·play하지 않지만 SFU가 바이트를 먼저 보낼 수 있다
    // (remote-faces pending). 출력 제어는 듣는 음량·모든 소리 끄기·친구별 목소리
    // 끄기(AudioControls)와 마이크 끄기(LocalControls)다.
    text: '상대의 얼굴과 음성은 화면과 소리로 나타나기 전에 기기로 먼저 수신될 수 있습니다. 게임 중 듣는 음량, 모든 소리 끄기, 친구별 목소리 끄기, 마이크 끄기로 조절할 수 있습니다.',
    evidence: [
      'apps/web/src/features/media/remote-faces.ts',
      'apps/web/src/features/media/pending-tracks.ts',
      'apps/web/src/features/game/flow/AudioControls.tsx',
      'apps/web/src/features/game/flow/LocalControls.tsx',
    ],
  },
  {
    // 서버에 DB가 없고 Egress·녹음 API를 쓰지 않는다. 세션·초대·방 상태는
    // 메모리 Map이며 방 만료(RoomExpiry)와 함께 사라진다. 디스크에는 매체가 아닌
    // 운영 저널(식별자·시각)만 남는다. 상대 단말의 화면 녹화는 막을 수 없다.
    text: '서비스는 얼굴과 음성을 저장하거나 녹화하지 않습니다. 방 정보와 닉네임은 서버 메모리에만 있고 방이 끝나거나 비어서 만료되면 지워집니다. 다른 참가자 기기의 화면 녹화까지 막지는 못합니다.',
    evidence: [
      'server/src/media/LiveKitGateway.ts',
      'server/src/session/ProductSessionStore.ts',
      'server/src/session/InviteStore.ts',
      'server/src/session/RoomExpiry.ts',
      'server/src/operations/OperationJournal.ts',
    ],
  },
];
