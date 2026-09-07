/**
 * 매치 룸 — 담당: 정유림 (E2)
 *
 * 0단계 뼈대:
 *  - 6인 방, 입장 시 Player 생성
 *  - move / turn / ready 메시지 수신 → domain 함수로 판정 → 상태 변경
 *  - 상태 머신 골격: waiting → playing → result
 *  - StateView 골격: 도망자에게만 exits 등록
 *
 * 규칙(벽·포획·승패)은 domain/ 에서 온다. 이 파일은 "전송과 전이"만 책임진다.
 */

import { Room, Client } from "colyseus";
import { StateView } from "@colyseus/schema";
import { GameState, Player, Exit } from "./schema/GameState";
import * as domain from "../domain";
import type { Dir, GameSnapshot, MoveDir, TurnDir, PlayerState } from "../domain";

const TICK_MS = 50; // 20 tick/s
const ROUND_MS = 3 * 60 * 1000;

type MoveMsg = { seq: number; dir: MoveDir };
type TurnMsg = { seq: number; dir: TurnDir };

export class KkakkungRoom extends Room<GameState> {
  maxClients = 6;

  /** 도메인 계산용 스냅샷(전송용 Schema 와 동기 유지) */
  private snapshot!: GameSnapshot;
  private playerState = new Map<string, PlayerState>();

  onCreate() {
    this.setState(new GameState());
    this.state.roomCode = this.roomId.slice(0, 6).toUpperCase();

    const maze = domain.generateMaze(Date.now());
    this.snapshot = {
      phase: "waiting",
      tick: 0,
      timeLeft: 0,
      maze,
      players: this.playerState,
    };
    this.state.maze.push(...Array.from(maze));

    this.onMessage<MoveMsg>("move", (client, msg) => this.handleMove(client, msg));
    this.onMessage<TurnMsg>("turn", (client, msg) => this.handleTurn(client, msg));
    this.onMessage("ready", (client) => this.handleReady(client));

    this.setSimulationInterval(() => this.tick(), TICK_MS);
    console.log(`[room ${this.state.roomCode}] created`);
  }

  onJoin(client: Client) {
    const index = this.state.players.size;
    // 0단계 임시 배정: 짝수 도망자, 홀수 술래. → [E2 서버 역할 배정] 스토리에서 교체
    const role = index % 2 === 0 ? "runner" : "tagger";
    const spawn = domain.pickSpawn(this.snapshot.maze as Uint8Array, role, Math.floor(index / 2));

    const p = new Player();
    p.id = client.sessionId;
    p.role = role;
    p.x = spawn.x;
    p.y = spawn.y;
    p.dir = spawn.dir;
    this.state.players.set(client.sessionId, p);

    this.playerState.set(client.sessionId, {
      id: client.sessionId,
      role,
      x: spawn.x,
      y: spawn.y,
      dir: spawn.dir,
      status: "alive",
      trapped: false,
      lastMoveAt: 0,
    });

    // StateView 골격: 도망자만 exits 를 본다. 술래 패킷에는 exits 필드가 없어야 한다.
    client.view = new StateView();
    if (role === "runner") {
      const exit = new Exit();
      exit.ownerId = client.sessionId;
      exit.wallX = 15; exit.wallY = 0; exit.side = 0;
      exit.approachX = 15; exit.approachY = 1;
      this.state.exits.set(client.sessionId, exit);
      client.view.add(exit);
    }

    console.log(`[room ${this.state.roomCode}] join ${client.sessionId} as ${role}`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.state.exits.delete(client.sessionId);
    this.playerState.delete(client.sessionId);
    console.log(`[room ${this.state.roomCode}] leave ${client.sessionId}`);
    // TODO [E2 연결 종료·장애 처리]: 경기 중 이탈 = 라운드 무효
  }

  onDispose() {
    console.log(`[room ${this.state.roomCode}] disposed`);
  }

  // ── 메시지 처리 ────────────────────────────────────────────────

  private handleMove(client: Client, msg: MoveMsg) {
    if (this.state.phase !== "playing") return;
    const ps = this.playerState.get(client.sessionId);
    const sp = this.state.players.get(client.sessionId);
    if (!ps || !sp) return;

    const now = Date.now();
    const res = domain.tryMove(this.snapshot, client.sessionId, msg.dir, now);
    if (!res.ok) {
      client.send("rejected", { seq: msg.seq, reason: res.reason });
      return;
    }
    const v = domain.DIR_VECTORS[ps.dir];
    const sign = msg.dir === "forward" ? 1 : -1;
    ps.x += v.dx * sign;
    ps.y += v.dy * sign;
    ps.lastMoveAt = now;
    sp.x = ps.x;
    sp.y = ps.y;
  }

  private handleTurn(client: Client, msg: TurnMsg) {
    if (this.state.phase !== "playing") return;
    const ps = this.playerState.get(client.sessionId);
    const sp = this.state.players.get(client.sessionId);
    if (!ps || !sp) return;
    ps.dir = domain.turn(ps.dir, msg.dir);
    sp.dir = ps.dir;
  }

  private handleReady(client: Client) {
    const sp = this.state.players.get(client.sessionId);
    if (!sp) return;
    sp.ready = true;

    // 0단계: 접속자 전원이 ready 면 시작 (6인 강제는 [E2 방·로비 관리] 에서)
    const all = Array.from(this.state.players.values());
    if (all.length >= 2 && all.every((p) => p.ready)) this.startRound();
  }

  // ── 상태 머신 골격: waiting → playing → result ────────────────

  private startRound() {
    this.state.phase = "playing";
    this.snapshot.phase = "playing";
    this.state.timeLeft = ROUND_MS;
    this.snapshot.timeLeft = ROUND_MS;
    this.lock();
    console.log(`[room ${this.state.roomCode}] round start`);
  }

  private endRound(winner: string) {
    this.state.phase = "result";
    this.snapshot.phase = "result";
    this.broadcast("result", { winner });
    console.log(`[room ${this.state.roomCode}] round end → ${winner}`);
  }

  private tick() {
    this.state.tick++;
    this.snapshot.tick = this.state.tick;
    if (this.state.phase !== "playing") return;

    this.state.timeLeft = Math.max(0, this.state.timeLeft - TICK_MS);
    this.snapshot.timeLeft = this.state.timeLeft;

    for (const ev of domain.checkCapture(this.snapshot)) {
      const runner = this.playerState.get(ev.runnerId);
      const sp = this.state.players.get(ev.runnerId);
      if (runner && sp) {
        runner.status = "captured";
        sp.status = "captured";
      }
      this.broadcast("captured", ev);
    }

    const winner = domain.checkWinCondition(this.snapshot);
    if (winner) return this.endRound(winner);
    if (this.state.timeLeft <= 0) return this.endRound("taggers");
  }
}
