// S15P21C204-303. 스키마 파서를 `new Function` 없이 돌게 하는 스위치.
//
// Zod 4 는 객체 스키마를 처음 parse 할 때 `new Function` 으로 전용 파서를 만들어 둔다. 그
// 한 줄 때문에 브라우저 CSP 의 `script-src` 에 `'unsafe-eval'` 이 필요해진다. `'unsafe-eval'`
// 을 열면 주입된 문자열이 코드가 될 수 있어 CSP 로 막으려던 것의 상당 부분이 무의미해진다.
//
// 측정한 것: 프로덕션 빌드를 엄격한 CSP 로 띄우면 첫 화면에서 `script-src <- eval` 위반이
// `$ZodObjectJIT` 에서 난다. 이 스위치를 켜면 사라진다.
//
// zod 를 쓰는 쪽은 이 패키지뿐이므로 스위치도 여기에 둔다. 서버는 부르지 않는다: CSP 아래에
// 있지 않고 매 tick 명령을 parse 하므로 JIT 의 속도를 포기할 이유가 없다.
import { config } from 'zod';

/** 첫 parse 보다 먼저 불러야 한다. 이미 만들어진 파서를 되돌리지는 않는다. */
export function useJitlessSchemas(): void {
  config({ jitless: true });
}
