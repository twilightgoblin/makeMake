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
                title: true,
                artist: true,
                album: true,
                duration: true,
                coverUrl: true,
                audioUrl: true,
            },
        }),
        prisma_js_1.prisma.song.count({ where }),
    ]);
    res.json({ songs, total, limit, offset });
});
//# sourceMappingURL=songs.js.map