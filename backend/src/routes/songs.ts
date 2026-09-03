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
        provider: true,
        externalId: true,
        title: true,
        artist: true,
        album: true,
        duration: true,
        coverUrl: true,
      },
    }),
    prisma.song.count({ where }),
  ]);

  res.json({ songs, total, limit, offset });
});

import { z } from "zod";
import { YouTubeService } from "../lib/YouTubeService.js";

// ---------------------------------------------------------------------------
// GET /songs/search
//
// Query params:
//   ?q=<string>        — search term for YouTube
//   ?limit=<int>       — default 20 (maxResults)
//   ?pageToken=<string>— page token
//
// Returns: 200 { songs: Song[], nextPageToken?: string }
// ---------------------------------------------------------------------------

songsRouter.get("/search", async (req, res) => {
  const limit = Math.min(Number(req.query["limit"]) || 20, 50);
  const search = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  const pageToken = typeof req.query["pageToken"] === "string" ? req.query["pageToken"] : undefined;

  try {
    const result = await YouTubeService.searchVideos(search, limit, pageToken);
    res.json(result);
  } catch (err) {
    console.error("YouTube search error:", err);
    res.status(500).json({ error: "Failed to search external catalog" });
  }
});

// ---------------------------------------------------------------------------
// POST /songs/import
//
// Body:
//   { provider: "youtube", externalId: "12345" }
//
// Returns: 200 Song (canonical Postgres record)
// ---------------------------------------------------------------------------

const importSchema = z.object({
  provider: z.literal("youtube"),
  externalId: z.string(),
});

songsRouter.post("/import", async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid import request" });
    return;
  }

  const { provider, externalId } = parsed.data;

  try {
    // 1. Check if we already imported it
    let song = await prisma.song.findUnique({
      where: {
        provider_externalId: { provider, externalId },
      },
    });

    if (song) {
      res.json(song);
      return;
    }

    // 2. Fetch canonical metadata from provider
    const canonical = await YouTubeService.getVideoById(externalId);

    // 3. Upsert into database (handles race conditions if 2 requests import at once)
    song = await prisma.song.upsert({
      where: {
        provider_externalId: { provider, externalId },
      },
      update: {},
      create: {
        provider: canonical.provider,
        externalId: canonical.externalId,
        title: canonical.title,
        artist: canonical.artist,
        album: canonical.album,
        duration: canonical.duration,
        coverUrl: canonical.coverUrl,
      },
    });

    res.json(song);
  } catch (err) {
    if (err instanceof Error && err.message === "VIDEO_NOT_EMBEDDABLE") {
      res.status(400).json({ error: "VIDEO_NOT_EMBEDDABLE", message: "This video cannot be embedded and will not play in MakeMake." });
      return;
    }
    console.error("Import error:", err);
    res.status(500).json({ error: "Failed to import song" });
  }
});
