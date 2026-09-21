// S15P21C204-303. 부수효과 전용 모듈. `main.tsx` 의 **첫 import** 여야 한다.
//
// ESM 은 모듈 본문보다 import 를 먼저 평가한다. 그래서 `main.tsx` 본문에서 스위치를 켜면
// 이미 `App` 의 모듈 그래프가 평가된 뒤라 늦는다. 실제로 그렇게 두었을 때 첫 화면에서
// `$ZodObjectJIT` 의 `new Function` 이 그대로 돌았다. import 순서로 해결한다.
import { useJitlessSchemas } from '@kkakkung/protocol/schema-runtime';

useJitlessSchemas();
