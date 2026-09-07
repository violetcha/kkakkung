/**
 * 전송용 상태 스키마 — 담당: 정유림 (E2 명령·상태 스키마 설계)
 *
 * ⚠️ 필드 이름은 프론트와의 계약이다. docs/protocol.md §2 와 반드시 일치.
 *    필드 추가는 자유, 이름 변경·삭제는 프론트 합의 후에만.
 *
 * @view() 가 붙은 것은 StateView 로 등록한 클라이언트에게만 전송된다.
 * 등록하지 않으면 패킷에 필드 자체가 없다 (숨기는 게 아니라 안 보내는 것).
 */

import { Schema, MapSchema, ArraySchema, type, view } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") role: string = "runner"; // "runner" | "tagger"
  @type("uint8") x: number = 0;
  @type("uint8") y: number = 0;
  @type("uint8") dir: number = 0; // 0북 1동 2남 3서
  @type("string") status: string = "alive"; // "alive" | "escaped" | "captured"
  @type("boolean") trapped: boolean = false;
  @type("boolean") ready: boolean = false;
}

/**
 * 개인 출구. 벽면에 붙어 있으므로 (벽 칸, 면, 접근 칸) 세 값이 필요하다.
 * 소유자와 발견한 도망자에게만 view 등록. 술래에게는 절대 등록하지 않는다.
 */
export class Exit extends Schema {
  @type("string") ownerId: string = "";
  @type("uint8") wallX: number = 0;
  @type("uint8") wallY: number = 0;
  @type("uint8") side: number = 0; // 벽의 어느 면인지 (0북 1동 2남 3서)
  @type("uint8") approachX: number = 0;
  @type("uint8") approachY: number = 0;
  @type("boolean") open: boolean = true;
}

export class GameState extends Schema {
  @type("string") phase: string = "waiting"; // waiting|prep|countdown|playing|result
  @type("number") tick: number = 0;
  @type("number") timeLeft: number = 0; // ms
  @type("string") roomCode: string = "";

  /** 32*32 = 1024, 0=통로 1=벽. 0단계는 전원 공개, 1단계에서 view 로 전환 */
  @type(["uint8"]) maze = new ArraySchema<number>();

  @type({ map: Player }) players = new MapSchema<Player>();

  /** 술래 패킷에 존재하지 않아야 한다 — StateView 골격 검증 대상 */
  @view() @type({ map: Exit }) exits = new MapSchema<Exit>();
}
