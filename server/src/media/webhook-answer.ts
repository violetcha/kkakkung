export class WebhookAuthenticationError extends Error {
  readonly statusCode = 401;
  constructor() {
    super('INVALID_WEBHOOK');
  }
}
/**
 * S15P21C204-381. The HTTP answer for one webhook delivery. A signature failure is 401, as its
 * error says; the route used to let it fall to the generic error handler, which answered 400.
 * Any other failure is rethrown so that handler still owns it.
 */
export async function answerWebhook(
  handle: () => Promise<unknown>,
): Promise<{ status: number; body: unknown }> {
  try {
    return { status: 200, body: await handle() };
  } catch (error) {
    if (error instanceof WebhookAuthenticationError)
      return { status: error.statusCode, body: { error: error.message } };
    throw error;
  }
}
