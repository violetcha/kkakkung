import assert from 'node:assert/strict';
import test from 'node:test';
import { INVITATION_ROUTES } from './types.ts';
import {
  operatorInvitationFixture,
  rejectedInvitationFixture,
  unavailableMapFixture,
  invalidPracticeFixture,
  unconfiguredMediaFixture,
  planningMetricFixture,
} from './fixtures.ts';

test('operator handoff fixes the invite endpoint, scoped request and failure union', () => {
  assert.deepEqual(INVITATION_ROUTES, {
    issue: '/api/operations/invitations',
    revoke: '/api/operations/invitations/:inviteId/revoke',
  });
  assert.equal(operatorInvitationFixture.scope.allowCreate, false);
  assert.equal(operatorInvitationFixture.scope.roomCodes.length, 1);
  assert.equal(rejectedInvitationFixture.status, 'rejected');
  assert.equal('invitation' in rejectedInvitationFixture, false);
});

test('map and practice handoffs expose failures without a fabricated successful layout', () => {
  assert.equal(unavailableMapFixture.status, 'invalid');
  assert.deepEqual(unavailableMapFixture.path, ['runnerSpawnRegions', 0]);
  assert.equal('template' in unavailableMapFixture, false);
  assert.equal(invalidPracticeFixture.code, 'INVALID_PRACTICE_LAYOUT');
  assert.equal('layout' in invalidPracticeFixture, false);
});

test('unconfigured operations fixture cannot stand in for a real public window or budget', () => {
  assert.equal(unconfiguredMediaFixture.publicWindow, null);
  assert.equal(unconfiguredMediaFixture.initialBudget, null);
  assert.equal(unconfiguredMediaFixture.productSecurityReady, false);
  assert.deepEqual(Object.keys(planningMetricFixture).sort(), ['atMs', 'name', 'unit', 'value']);
  assert.equal(planningMetricFixture.unit, 'ms');
});
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
  layoutSelectionFixture,
  fallbackLayoutFixture,
  fallbackSessionPlayers,
  expectedFallbackSlotBindings,
  reboundFallbackLayoutFixture,
  invalidFallbackSlotInputs,
  incompleteFallbackRebindings,
  mapTemplateFixture,
  invalidRegionFixtures,
  fallbackMetadataCases,
  layoutSelectionBudgetCases,
  scopeTransitionViews,
  sameScopePhaseResend,
  scopeDeliveryCases,
  privateViewBarrierCases,
  scopedEventCases,
  futureEventQueueCases,
  initializationIdempotenceCase,
  initializationListenCases,
  grantAdmissionCases,
  isolatedDeploymentStages,
  isolatedDeploymentSuccess,
  isolatedDeploymentFailures,
  invalidDeploymentOrders,
  rollbackDeploymentOrder,
} from './fixtures.ts';
import type { Cell, LayoutTemplate, LayoutSelectionInput, MatchLayout } from './types.ts';

// These checks validate shared example data. They do not execute game-core, web runtime,
// MediaCoordinator, Cloud, deployment scripts, or the real six-device smoke test.

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

const cellKey = (cell: Cell) => `${cell.x},${cell.y}`;
function regionFixtureViolations(template: LayoutTemplate): Set<string> {
  const violations = new Set<string>();
  const isWalkable = ({ x, y }: Cell) =>
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < template.topology.width &&
    y >= 0 &&
    y < template.topology.height &&
    template.topology.walkable[y * template.topology.width + x] === true;
  // Roles are checked independently. Shared cells between the two role partitions are allowed.
  for (const regions of [template.taggerRegions, template.runnerSpawnRegions]) {
    const previous = new Set<string>();
    for (const region of regions) {
      const own = new Set(region.cells.map(cellKey));
      if (region.spawnCandidates.length === 0) violations.add('empty-candidates');
      for (const cell of region.cells) {
        if (!isWalkable(cell)) violations.add('non-walkable-region');
        if (previous.has(cellKey(cell))) violations.add('same-role-overlap');
      }
      for (const candidate of region.spawnCandidates) {
        if (!own.has(cellKey(candidate))) violations.add('candidate-outside-region');
        if (!isWalkable(candidate)) violations.add('non-walkable-candidate');
      }
      for (const key of own) previous.add(key);
    }
  }
  return violations;
}

test('synthetic map input binds three regions per role to source metadata and the six-player layout', () => {
  const { template, players, fallback } = layoutSelectionFixture;
  assert.equal(template.topology.walkable.length, 32 * 32);
  assert.equal(template.taggerRegions.length, 3);
  assert.equal(template.runnerSpawnRegions.length, 3);
  assert.equal(new Set(players.map((player) => player.playerId)).size, 6);
  for (const role of ['tagger', 'runner'])
    assert.equal(players.filter((player) => player.role === role).length, 3);
  assert.deepEqual(regionFixtureViolations(template), new Set());
  assert.deepEqual(template.taggerRegions[0].cells, template.runnerSpawnRegions[0].cells);
  const expectedOwners = fallback.layout.players
    .filter((player) => player.role === 'tagger')
    .map((player) => player.playerId);
  assert.deepEqual(
    fallback.layout.territories.map((region) => region.playerId),
    expectedOwners,
  );
  assert.notDeepEqual(
    fallback.layout.players.map((player) => player.playerId).sort(),
    players.map((player) => player.playerId).sort(),
  );
  for (const exit of fallback.layout.exits) {
    assert.ok(
      fallback.layout.players.some(
        (player) => player.playerId === exit.ownerId && player.role === 'runner',
      ),
    );
    assert.ok(
      template.exitCandidates.some(
        (face) => face.x === exit.wall.x && face.y === exit.wall.y && face.side === exit.wall.side,
      ),
    );
  }
  for (const field of ['templateId', 'templateVersion', 'templateHash', 'variantId'] as const)
    assert.equal(template[field], fallback[field]);
});

function fallbackSlotFixtureViolations(input: LayoutSelectionInput): Set<string> {
  const violations = new Set<string>();
  const saved = input.fallback.layout;
  const slots = new Set(saved.players.map((player) => player.playerId));
  const expectedSlots = ['tagger-1', 'tagger-2', 'tagger-3', 'runner-1', 'runner-2', 'runner-3'];
  if (
    saved.players.length !== 6 ||
    slots.size !== 6 ||
    expectedSlots.some((slot) => !slots.has(slot))
  )
    violations.add('missing-or-duplicate-slot');
  for (const player of saved.players)
    if (!player.playerId.startsWith(`${player.role}-`)) violations.add('slot-role-mismatch');
  for (const role of ['tagger', 'runner'])
    if (input.players.filter((player) => player.role === role).length !== 3)
      violations.add('current-role-count');
  const savedRoles = new Map(saved.players.map((player) => [player.playerId, player.role]));
  for (const exit of saved.exits)
    if (savedRoles.get(exit.ownerId) !== 'runner') violations.add('exit-owner-role');
  for (const territory of saved.territories)
    if (savedRoles.get(territory.playerId) !== 'tagger') violations.add('territory-owner-role');
  return violations;
}

const layoutIdentityReferences = (layout: MatchLayout) => [
  ...layout.players.map((player) => player.playerId),
  ...layout.exits.map((exit) => exit.ownerId),
  ...layout.territories.map((region) => region.playerId),
];

test('fallback identity examples map stable slots by default string order for each role', () => {
  assert.equal(fallbackSlotFixtureViolations(layoutSelectionFixture).size, 0);
  for (const role of ['tagger', 'runner'] as const) {
    const ordered = fallbackSessionPlayers
      .filter((player) => player.role === role)
      .map((player) => player.playerId)
      .sort();
    assert.deepEqual(
      ordered,
      role === 'tagger'
        ? ['session-t-10', 'session-t-Z', 'session-t-a']
        : ['session-r-2', 'session-r-Z', 'session-r-b'],
    );
    for (let index = 0; index < ordered.length; index++)
      assert.equal(
        expectedFallbackSlotBindings[
          `${role}-${index + 1}` as keyof typeof expectedFallbackSlotBindings
        ],
        ordered[index],
      );
  }
  const sessions = new Map(
    fallbackSessionPlayers.map((player) => [player.playerId as string, player.role]),
  );
  for (const player of reboundFallbackLayoutFixture.players)
    assert.equal(sessions.get(player.playerId), player.role);
  for (const exit of reboundFallbackLayoutFixture.exits)
    assert.equal(sessions.get(exit.ownerId), 'runner');
  for (const territory of reboundFallbackLayoutFixture.territories)
    assert.equal(sessions.get(territory.playerId), 'tagger');
  assert.ok(layoutIdentityReferences(reboundFallbackLayoutFixture).every((id) => sessions.has(id)));
  assert.deepEqual(
    reboundFallbackLayoutFixture.players.map(({ cell, dir }) => ({ cell, dir })),
    fallbackLayoutFixture.players.map(({ cell, dir }) => ({ cell, dir })),
  );
  assert.equal(fallbackLayoutFixture.players[0].playerId, 'tagger-1');
  assert.equal(fallbackLayoutFixture.exits[0].ownerId, 'runner-1');
  assert.equal(fallbackLayoutFixture.territories[0].playerId, 'tagger-1');
});

test('malformed saved slots, ownership roles and current role counts have explicit unavailable outcomes', () => {
  for (const fixture of invalidFallbackSlotInputs) {
    assert.ok(
      fallbackSlotFixtureViolations(fixture.input).has(fixture.expectedViolation),
      fixture.name,
    );
    assert.deepEqual(fixture.expectedCertification, {
      status: 'unavailable',
      code: 'LAYOUT_UNAVAILABLE',
    });
  }
});

test('partial rebinding examples reveal leftover slots in players, exits and territories independently', () => {
  const persistedSlots = new Set<string>(
    fallbackLayoutFixture.players.map((player) => player.playerId),
  );
  for (const fixture of incompleteFallbackRebindings) {
    const remaining = layoutIdentityReferences(fixture.layout).filter((id) =>
      persistedSlots.has(id),
    );
    assert.equal(remaining.length, fixture.expectedRemainingSlots, fixture.name);
    assert.equal(fixture.expectedCertification.status, 'unavailable');
  }
  assert.equal(
    layoutIdentityReferences(reboundFallbackLayoutFixture).filter((id) => persistedSlots.has(id))
      .length,
    0,
  );
});

test('bad map examples expose same-role overlap, empty/outside candidates and wall cells', () => {
  for (const fixture of invalidRegionFixtures) {
    assert.ok(
      regionFixtureViolations(fixture.template).has(fixture.expectedViolation),
      `${fixture.name} must contain its documented violation`,
    );
  }
  assert.equal(regionFixtureViolations(mapTemplateFixture).size, 0);
});

test('each fallback source-field mismatch is independently distinguishable before selection', () => {
  for (const fixture of fallbackMetadataCases) {
    const mismatch = { ...layoutSelectionFixture.fallback, [fixture.field]: fixture.value };
    const differing = (
      ['templateId', 'templateVersion', 'templateHash', 'variantId'] as const
    ).filter((field) => mismatch[field] !== mapTemplateFixture[field]);
    assert.deepEqual(differing, [fixture.field]);
  }
});

test('selection examples bound generator batches, total attempts and elapsed budget', () => {
  for (const fixture of layoutSelectionBudgetCases) {
    const expected =
      fixture.batchAttempts > 8
        ? 'invalid-progress'
        : fixture.attempted >= layoutSelectionFixture.maxAttempts || fixture.elapsedMs >= 100
          ? 'use-prevalidated-fallback'
          : 'continue';
    assert.equal(fixture.expected, expected);
  }
});

test('view examples preserve match/state ordering while separating none, practice and game instances', () => {
  assert.equal(new Set(scopeTransitionViews.map((view) => view.matchId)).size, 1);
  assert.deepEqual(
    scopeTransitionViews.map((view) => view.gameScope.revision),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    scopeTransitionViews.map((view) => view.gameScope.kind),
    ['none', 'practice', 'none', 'game'],
  );
  for (let i = 1; i < scopeTransitionViews.length; i++)
    assert.ok(scopeTransitionViews[i].stateVersion > scopeTransitionViews[i - 1].stateVersion);
  assert.equal(scopeTransitionViews[2].self, null);
  assert.deepEqual(scopeTransitionViews[2].knownTerrain, []);
  assert.notDeepEqual(scopeTransitionViews[1].knownTerrain, scopeTransitionViews[3].knownTerrain);
  assert.equal(scopeTransitionViews[3].self?.playerId, 'r1');
  for (const fixture of scopeDeliveryCases) {
    const incoming = fixture.incoming.gameScope;
    if (fixture.expected === 'discard-old-scope')
      assert.ok(incoming.revision < fixture.current.revision);
    else if (fixture.expected === 'reject-and-resync') {
      assert.equal(incoming.revision, fixture.current.revision);
      assert.notEqual(incoming.gameInstanceId, fixture.current.gameInstanceId);
    } else {
      assert.ok(incoming.revision > fixture.current.revision);
      assert.equal(incoming.kind, 'game');
      assert.equal(
        fixture.publicPhase === 'GAME_LOADING',
        fixture.expected === 'replace-entire-view',
      );
    }
  }
});

test('same-scope phase transition example resends once above the transition floor', () => {
  const { previous, publicTransition, resent, laterVersionOnly } = sameScopePhaseResend;
  const { stateVersion: previousVersion, ...previousContents } = previous;
  const { stateVersion: resentVersion, ...resentContents } = resent;
  assert.notEqual(publicTransition.from, publicTransition.to);
  assert.deepEqual(previousContents, resentContents);
  assert.ok(resentVersion > previousVersion);
  assert.ok(resent.stateVersion >= publicTransition.stateVersion);
  assert.equal(sameScopePhaseResend.expectedFullViewSends, 1);
  assert.equal(laterVersionOnly.phase, publicTransition.to);
  assert.ok(laterVersionOnly.stateVersion > resent.stateVersion);
  assert.equal(laterVersionOnly.expectedFullViewSends, 0);
});

test('private event examples reject older instances and bound future-scope waiting at 64 events/1000ms', () => {
  for (const fixture of scopedEventCases) {
    const delta = fixture.event.gameScope.revision - fixture.current.revision;
    if (fixture.expected === 'reject-and-resync') {
      assert.equal(delta, 0);
      assert.notEqual(fixture.event.gameScope.gameInstanceId, fixture.current.gameInstanceId);
      continue;
    }
    assert.equal(fixture.expected, delta < 0 ? 'discard' : delta > 0 ? 'bounded-wait' : 'deliver');
    if (delta === 0)
      assert.equal(fixture.event.gameScope.gameInstanceId, fixture.current.gameInstanceId);
  }
  for (const fixture of futureEventQueueCases) {
    const requiresResync = fixture.buffered >= 64 || fixture.ageMs >= 1000;
    assert.equal(fixture.expected === 'discard-and-resync', requiresResync);
    assert.equal(fixture.expectedAfterEnqueue, requiresResync ? 0 : fixture.buffered + 1);
  }
});

test('private view examples preserve the public-transition floor and bounded look-ahead', () => {
  for (const fixture of privateViewBarrierCases) {
    if (fixture.expected === 'hold-latest-one') {
      assert.ok(fixture.viewVersion > fixture.publicVersion);
      assert.ok(fixture.waitMs < 1000);
    } else if (fixture.expected === 'apply-after-phase-check') {
      assert.ok(fixture.publicVersion >= fixture.viewVersion);
      assert.ok(fixture.viewVersion >= fixture.transitionMinimumVersion);
      assert.ok(fixture.viewVersion >= fixture.lastAppliedVersion);
    } else if (fixture.expected === 'discard-old-state') {
      assert.ok(fixture.viewVersion < fixture.lastAppliedVersion);
    } else {
      assert.ok(fixture.viewVersion < fixture.transitionMinimumVersion || fixture.waitMs >= 1000);
    }
  }
});

test('initialize examples distinguish HTTP availability from recovery, admission and token issuance', () => {
  for (const fixture of initializationListenCases) {
    assert.equal(fixture.expectedListen, fixture.result.status === 'initialized');
    assert.equal(fixture.expectedGrantCount, 0);
    if (fixture.result.status === 'initialized') {
      assert.equal(fixture.result.admission, 'DRAINING');
      assert.ok(['RECOVERING', 'LOCKED'].includes(fixture.result.readiness.state));
    }
  }
  assert.equal(initializationIdempotenceCase.concurrentCalls.length, 2);
  assert.equal(new Set(initializationIdempotenceCase.expectedPromiseIdentities).size, 1);
  assert.equal(initializationIdempotenceCase.expectedWriterAcquisitions, 1);
  for (const fixture of grantAdmissionCases) {
    assert.equal(
      fixture.expectedGrant,
      fixture.status.readiness === 'READY' && fixture.status.admission === 'OPEN',
    );
  }
});

test('isolated deployment example resumes before smoke and publishes only after cleanup', () => {
  assert.deepEqual(
    isolatedDeploymentSuccess.map((step) => step.stage),
    isolatedDeploymentStages,
  );
  assert.ok(
    isolatedDeploymentSuccess.slice(0, -1).every((step) => step.externalRoute === 'blocked'),
  );
  const resume = isolatedDeploymentSuccess.find((step) => step.stage === 'isolated-resume')!;
  const smoke = isolatedDeploymentSuccess.find((step) => step.stage === 'six-player-smoke')!;
  const cleanup = isolatedDeploymentSuccess.find((step) => step.stage === 'cleanup')!;
  const publish = isolatedDeploymentSuccess.find((step) => step.stage === 'publish')!;
  assert.equal(resume.admission, 'OPEN');
  assert.equal(smoke.activeSessions, 6);
  assert.equal(smoke.readiness, 'READY');
  assert.equal(smoke.externalRoute, 'blocked');
  for (const step of [cleanup, publish]) {
    assert.equal(step.activeSessions, 0);
    assert.equal(step.unresolvedCount, 0);
  }
  assert.equal(publish.externalRoute, 'public');
});

test('deployment examples expose unsafe ordering and bounded failure without releasing isolation', () => {
  for (const fixture of invalidDeploymentOrders)
    assert.notDeepEqual(fixture.stages, isolatedDeploymentStages, fixture.name);
  assert.deepEqual(
    isolatedDeploymentFailures.map((fixture) => fixture.failedStage),
    isolatedDeploymentStages,
  );
  for (const fixture of isolatedDeploymentFailures) {
    assert.equal(fixture.expectedExternalRoute, 'blocked');
    assert.equal(fixture.expectedPublishCompleted, false);
    assert.ok(fixture.elapsedMs >= fixture.fixtureDeadlineMs);
    assert.equal(fixture.expected, 'abort-and-keep-isolation');
  }
  assert.deepEqual(rollbackDeploymentOrder.slice(0, 4), [
    're-isolate',
    're-drain-succeeded',
    'cleanup-zero-activity-and-unresolved',
    'deploy-previous-image',
  ]);
});
