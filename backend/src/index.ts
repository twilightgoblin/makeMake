import "dotenv/config";
import express from "express";
import { prisma } from "./lib/prisma";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

// ----------------------------------------------------------------------------
// Health check
// Verifies the server is up and Prisma can reach the database.
// ----------------------------------------------------------------------------
app.get("/health", async (_req, res) => {
  try {
    // A lightweight query — just confirms the DB connection is alive.
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    console.error("[health] DB connection failed:", err);
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
