import http from "http";
import dotenv from "dotenv";
import { app } from "./app";
import { initSocketServer } from "./socket/socket";

dotenv.config();

const PORT = Number(process.env.PORT) || 3001;

const httpServer = http.createServer(app)

initSocketServer(httpServer)

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
})
