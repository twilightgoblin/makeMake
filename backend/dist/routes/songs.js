"use strict";
// -----------------------------------------------------------------------------
// Makemake — Songs routes
//
// GET /songs — browse the global seeded music library.
// No auth required — the library is public.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.songsRouter = void 0;
const express_1 = require("express");
const prisma_js_1 = require("../lib/prisma.js");
const validate_js_1 = require("../lib/validate.js");
exports.songsRouter = (0, express_1.Router)();
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
exports.songsRouter.get("/", async (req, res) => {
    const { limit, offset } = (0, validate_js_1.parsePagination)(req.query);
    const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : undefined;
    const where = search
        ? {
            OR: [
                { title: { contains: search, mode: "insensitive" } },
                { artist: { contains: search, mode: "insensitive" } },
                { album: { contains: search, mode: "insensitive" } },
            ],
        }
        : {};
    const [songs, total] = await Promise.all([
        prisma_js_1.prisma.song.findMany({
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
        prisma_js_1.prisma.song.count({ where }),
    ]);
    res.json({ songs, total, limit, offset });
});
const zod_1 = require("zod");
const YouTubeService_js_1 = require("../lib/YouTubeService.js");
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
exports.songsRouter.get("/search", async (req, res) => {
    const limit = Math.min(Number(req.query["limit"]) || 20, 50);
    const search = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
    const pageToken = typeof req.query["pageToken"] === "string" ? req.query["pageToken"] : undefined;
    try {
        const result = await YouTubeService_js_1.YouTubeService.searchVideos(search, limit, pageToken);
        res.json(result);
    }
    catch (err) {
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
const importSchema = zod_1.z.object({
    provider: zod_1.z.literal("youtube"),
    externalId: zod_1.z.string(),
});
exports.songsRouter.post("/import", async (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid import request" });
        return;
    }
    const { provider, externalId } = parsed.data;
    try {
        // 1. Check if we already imported it
        let song = await prisma_js_1.prisma.song.findUnique({
            where: {
                provider_externalId: { provider, externalId },
            },
        });
        if (song) {
            res.json(song);
            return;
        }
        // 2. Fetch canonical metadata from provider
        const canonical = await YouTubeService_js_1.YouTubeService.getVideoById(externalId);
        // 3. Upsert into database (handles race conditions if 2 requests import at once)
        song = await prisma_js_1.prisma.song.upsert({
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
    }
    catch (err) {
        if (err instanceof Error && err.message === "VIDEO_NOT_EMBEDDABLE") {
            res.status(400).json({ error: "VIDEO_NOT_EMBEDDABLE", message: "This video cannot be embedded and will not play in MakeMake." });
            return;
        }
        console.error("Import error:", err);
        res.status(500).json({ error: "Failed to import song" });
    }
});
//# sourceMappingURL=songs.js.map