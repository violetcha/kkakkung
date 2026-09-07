import { Client } from "colyseus.js";
const c = new Client("ws://localhost:2567");
const a = await c.joinOrCreate("kkakkung");           // 1번 입장 → runner
const b = await c.joinById(a.roomId);                 // 2번 입장 → tagger
await new Promise(r => setTimeout(r, 400));

const sa = a.state.toJSON(), sb = b.state.toJSON();
console.log("A role:", sa.players[a.sessionId].role, "| exits in A packet:", Object.keys(sa.exits ?? {}).length);
console.log("B role:", sb.players[b.sessionId].role, "| exits in B packet:", sb.exits === undefined ? "FIELD ABSENT" : Object.keys(sb.exits).length);

a.send("ready", {}); b.send("ready", {});
await new Promise(r => setTimeout(r, 300));
console.log("phase:", b.state.phase, "| timeLeft:", b.state.timeLeft);

const before = { ...b.state.players.get(a.sessionId).toJSON() };
a.send("move", { seq: 1, dir: "forward" });
await new Promise(r => setTimeout(r, 300));
const after = b.state.players.get(a.sessionId).toJSON();
console.log("A pos seen by B:", `(${before.x},${before.y})`, "→", `(${after.x},${after.y})`);

a.onMessage("rejected", m => console.log("rejected:", m));
for (let i = 0; i < 3; i++) a.send("move", { seq: 10 + i, dir: "back" });
await new Promise(r => setTimeout(r, 400));
console.log("A pos after 3 back:", b.state.players.get(a.sessionId).toJSON().x, b.state.players.get(a.sessionId).toJSON().y);
a.leave(); b.leave(); process.exit(0);
