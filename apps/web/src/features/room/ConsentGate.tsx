// S15P21C204-292. 카메라를 켜기 전에 지나야 하는 동의 화면.
//
// 로비에서는 같은 문장을 보여 주기만 했다. 읽지 않고 장치 점검으로 넘어갈 수 있었고 장치 점검
// 화면에는 안내가 없었다. 여기서는 장치 제어 대신 이 화면이 나오고, 두 확인을 모두 켜야 진행한다.
//
// 문장은 `privacy-notice.ts` 의 것을 그대로 쓴다. 이 파일에서 새 사실을 지어내지 않는다.
import { useState } from 'react';
import { PRIVACY_NOTICE, PRIVACY_NOTICE_VERSION } from './privacy-notice';

export function ConsentGate({
  onAccept,
  heading = '카메라를 켜기 전에',
}: {
  /** 두 확인을 모두 받은 뒤 호출된다. */
  onAccept(): void;
  heading?: string;
}) {
  const [read, setRead] = useState(false);
  const [age, setAge] = useState(false);
  const ready = read && age;
  return (
    <section className="consent-gate" aria-label="개인정보 처리 동의">
      <h2>{heading}</h2>
      <p>이 게임은 얼굴과 음성을 사용합니다. 아래 내용을 읽고 동의해야 카메라를 켤 수 있습니다.</p>
      <ul className="notice" aria-label="개인정보 처리 안내">
        {PRIVACY_NOTICE.map((sentence) => (
          <li key={sentence.text}>{sentence.text}</li>
        ))}
      </ul>
      <div className="consent-gate-confirms">
        <label>
          <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />위
          내용을 읽고 동의합니다.
        </label>
        <label>
          <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} />만 14세
          이상입니다.
        </label>
      </div>
      <button type="button" disabled={!ready} onClick={onAccept}>
        동의하고 장치 점검으로
      </button>
      <small>
        동의하지 않으면 이 창을 닫으면 됩니다. 동의는 이 기기에 저장되며 안내가 바뀌면 다시
        묻습니다. (안내 {PRIVACY_NOTICE_VERSION})
      </small>
    </section>
  );
}
