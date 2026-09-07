import express from "express";
import { createServer } from "http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import { playground } from "@colyseus/playground";
import { KkakkungRoom } from "./rooms/KkakkungRoom";

const PORT = Number(process.env.PORT ?? 2567);

const app = express();
app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true }));

// 개발용 도구. 배포 시 인증 뒤로 숨기거나 제거한다.
if (process.env.NODE_ENV !== "production") {
  app.use("/playground", playground());
}
app.use("/monitor", monitor());

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("kkakkung", KkakkungRoom);

gameServer.listen(PORT).then(() => {
  console.log(`⚡ kkakkung server  ws://localhost:${PORT}`);
  console.log(`   playground       http://localhost:${PORT}/playground`);
  console.log(`   monitor          http://localhost:${PORT}/monitor`);
});
