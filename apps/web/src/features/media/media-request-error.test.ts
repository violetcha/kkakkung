import { expect, it } from 'vitest';
import { MediaRequestError, mediaFailureText, mediaRequestError } from './media-request-error';

const response = (status: number, body: unknown) => ({
  status,
  json: async () => {
    if (body === undefined) throw new Error('no body');
    return body;
  },
});

// S15P21C204-394. 서버가 준 거절 코드가 화면 문구까지 닿는다.
it('reads the server rejection code from the body', async () => {
  const error = await mediaRequestError(response(409, { error: 'BUDGET_EXHAUSTED' }));
  expect(error).toBeInstanceOf(MediaRequestError);
  expect(error).toMatchObject({ status: 409, code: 'BUDGET_EXHAUSTED' });
  expect((await mediaRequestError(response(502, undefined))).code).toBeNull();
  expect((await mediaRequestError(response(409, { error: 7 }))).code).toBeNull();
});

it('names the stage and the server code, with a sentence when the code is known', () => {
  expect(
    mediaFailureText('MEDIA_PREPARATION_FAILED', new MediaRequestError(409, 'BUDGET_EXHAUSTED')),
  ).toBe(
    '미디어 준비에 실패했습니다. 이번 달 영상·음성 사용량이 한도에 가까워 연결하지 않았습니다. (MEDIA_PREPARATION_FAILED · BUDGET_EXHAUSTED)',
  );
  expect(mediaFailureText('MEDIA_CONNECT_FAILED', new Error('sdk'))).toBe(
    '미디어 준비에 실패했습니다. (MEDIA_CONNECT_FAILED)',
  );
  expect(mediaFailureText('MEDIA_PREPARATION_FAILED', new MediaRequestError(409, 'NEW_CODE'))).toBe(
    '미디어 준비에 실패했습니다. (MEDIA_PREPARATION_FAILED · NEW_CODE)',
  );
});
