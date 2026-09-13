import { GatewayError, type GatewayCallContext, type LiveKitGateway } from './LiveKitGateway.js';

/** Only call after every target's removal ACK. Absence never substitutes for token revocation. */
export async function areRevokedMediaTargetsAbsent(
  targets: readonly Readonly<{ roomName: string; identity: string }>[],
  gateway: Pick<LiveKitGateway, 'listParticipants'>,
  context: () => GatewayCallContext,
): Promise<boolean> {
  for (const roomName of new Set(targets.map((target) => target.roomName))) {
    try {
      const participants = await gateway.listParticipants(roomName, context());
      if (
        participants.some((participant) =>
          targets.some(
            (target) => target.roomName === roomName && target.identity === participant.identity,
          ),
        )
      )
        return false;
    } catch (error) {
      if (
        !(error instanceof GatewayError) ||
        error.code !== 'not_found' ||
        error.status !== 404 ||
        error.outcomeUnknown
      )
        throw error;
    }
  }
  return true;
}
