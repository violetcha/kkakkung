import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptedThenRejected,
  rejectedBeforeQueue,
  endedWhilePending,
  requestLookup,
  firstBindings,
  onePublisherReconnected,
  remoteFace,
  audioPolicy,
  faceArrivalOrders,
  audioArrivalOrders,
  stalePoseWithNewFace,
  missingPose,
  exchangeViews,
  otherPlayersSensor,
  observedExit,
  hearingBoundary,
  playbackReplacementCases,
} from './fixtures.ts';

test('request fixtures correlate acceptance, unchanged-state rejection, cancellation and lookup', () => {
  const { command, receipt, outcome } = acceptedThenRejected;
  assert.equal(receipt.status, 'accepted');
  assert.equal(outcome.result, 'rejected');
  assert.equal(outcome.requestId, command.requestId);
  assert.equal(outcome.sequence, command.sequence);
  assert.equal(receipt.stateVersion, outcome.stateVersion);
  assert.equal(endedWhilePending.result, 'canceled');
  assert.equal(endedWhilePending.code, 'ROUND_ENDED');
  assert.deepEqual(requestLookup.outcome, outcome);
  assert.equal(acceptedThenRejected.expected.uiPending, false);
  assert.equal(rejectedBeforeQueue.receipt.status, 'rejected');
  assert.equal(rejectedBeforeQueue.expected.uiPending, false);
  assert.equal(rejectedBeforeQueue.expected.waitsForOutcome, false);
  assert.equal(rejectedBeforeQueue.expected.startsStatusTimer, false);
});

test('single publisher reconnect preserves receiver and self generation but changes sender identity/SIDs', () => {
  assert.equal(firstBindings.receiverGeneration, onePublisherReconnected.receiverGeneration);
  assert.deepEqual(firstBindings.participants[0], onePublisherReconnected.participants[0]);
  assert.notEqual(
    firstBindings.participants[1].publisherGeneration,
    onePublisherReconnected.participants[1].publisherGeneration,
  );
  assert.notEqual(
    firstBindings.participants[1].mediaIdentity,
    onePublisherReconnected.participants[1].mediaIdentity,
  );
  assert.notEqual(
    firstBindings.participants[1].participantSid,
    onePublisherReconnected.participants[1].participantSid,
  );
  assert.ok(onePublisherReconnected.bindingRevision > firstBindings.bindingRevision);
});

test('arrival fixtures cover both face orders and all six audio orders with matching publisher references', () => {
  assert.equal(new Set(faceArrivalOrders.map((x) => x.order.join('/'))).size, 2);
  assert.equal(new Set(audioArrivalOrders.map((x) => x.join('/'))).size, 6);
  for (const order of audioArrivalOrders)
    assert.deepEqual([...order].sort(), ['bindings', 'policy', 'track']);
  assert.equal(remoteFace.trackSid, firstBindings.participants[1].faceTrackSid);
  assert.equal(audioPolicy.voices[0].trackSid, firstBindings.participants[1].audioTrackSid);
  assert.equal(audioPolicy.bindingRevision, firstBindings.bindingRevision);
});

test('fresh face fixture cannot refresh a stale pose; a new missing observation has its own identity', () => {
  assert.ok(stalePoseWithNewFace.emittedAtMs - stalePoseWithNewFace.pose.sampledAtMs > 300);
  assert.equal(stalePoseWithNewFace.emittedAtMs - stalePoseWithNewFace.face.sampledAtMs, 0);
  assert.ok(missingPose.pose.frameId > stalePoseWithNewFace.pose.frameId);
  assert.equal(missingPose.pose.status, 'missing');
  assert.equal(missingPose.pose.data, null);
});

test('exchange fixture distinguishes the same session as outgoing and incoming', () => {
  assert.equal(exchangeViews.incoming.exchangeId, exchangeViews.outgoing.exchangeId);
  assert.equal(exchangeViews.incoming.toPlayerId, exchangeViews.outgoing.toPlayerId);
  assert.equal(exchangeViews.outgoing.direction, 'outgoing');
  assert.equal(exchangeViews.incoming.direction, 'incoming');
  assert.notEqual(exchangeViews.incoming.fromPlayerId, exchangeViews.incoming.toPlayerId);
});

test('observed wall fixtures identify adjacent sensor/exit faces without hidden-map input', () => {
  assert.equal(
    Math.abs(otherPlayersSensor.cell.x - otherPlayersSensor.wall.x) +
      Math.abs(otherPlayersSensor.cell.y - otherPlayersSensor.wall.y),
    1,
  );
  assert.equal(
    Math.abs(observedExit.approach.x - observedExit.wall.x) +
      Math.abs(observedExit.approach.y - observedExit.wall.y),
    1,
  );
  assert.equal(otherPlayersSensor.wall.side, 2);
  assert.equal(observedExit.wall.side, 3);
});

test('hearing stimulus exercises both entry and strict exit and retains state at six', () => {
  assert.ok(hearingBoundary.some((x) => x.distance === 7 && x.wasAllowed && !x.allowed));
  assert.ok(hearingBoundary.some((x) => x.distance === 5 && !x.wasAllowed && x.allowed));
  for (const x of hearingBoundary.filter((x) => x.distance === 6))
    assert.equal(x.allowed, x.wasAllowed);
});

test('replacement scenarios do not require a publication event for same-SID source replacement', () => {
  const same = playbackReplacementCases.find((x) => x.kind === 'same-sid');
  assert.equal(same?.expectsPublicationChange, false);
  assert.equal(same?.expected, 'keep-policy-check-new-marker');
});
