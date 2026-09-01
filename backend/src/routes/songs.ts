// -----------------------------------------------------------------------------
// Makemake — Songs routes
//
// GET /songs — browse the global seeded music library.
// No auth required — the library is public.
// -----------------------------------------------------------------------------

import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { parsePagination } from "../lib/validate.js";

export const songsRouter = Router();

// ---------------------------------------------------------------------------
// GET /songs
//
// Query params:
//   ?search=<string>   — case-insensitive substring match on title or artist
//   ?limit=<int>       — default 50, max 100
//   ?offset=<int>      — default 0
//
// Returns: 200 { songs: Song[], total: number }
// ---------------------------------------------------------------------------

songsRouter.get("/", async (req, res) => {
  const { limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const search =
    typeof req.query["search"] === "string" ? req.query["search"].trim() : undefined;

  const where = search
    ? {
        OR: [
          { title: { contains: search, mode: "insensitive" as const } },
          { artist: { contains: search, mode: "insensitive" as const } },
          { album: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [songs, total] = await Promise.all([
    prisma.song.findMany({
      where,
      orderBy: [{ artist: "asc" }, { title: "asc" }],
      skip: offset,
      take: limit,
      select: {
        id: true,
        title: true,
        artist: true,
        album: true,
        duration: true,
        coverUrl: true,
        audioUrl: true,
      },
    }),
    prisma.song.count({ where }),
  ]);

  res.json({ songs, total, limit, offset });
});
