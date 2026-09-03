"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YouTubeService = void 0;
const zod_1 = require("zod");
const youtubeSearchResponseSchema = zod_1.z.object({
    nextPageToken: zod_1.z.string().optional(),
    items: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.object({
            videoId: zod_1.z.string()
        }),
        snippet: zod_1.z.object({
            title: zod_1.z.string(),
            channelTitle: zod_1.z.string(),
            thumbnails: zod_1.z.object({
                high: zod_1.z.object({
                    url: zod_1.z.string()
                }).optional(),
                default: zod_1.z.object({
                    url: zod_1.z.string()
                }).optional()
            }).optional()
        })
    }))
});
const youtubeVideoResponseSchema = zod_1.z.object({
    items: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string(),
        snippet: zod_1.z.object({
            title: zod_1.z.string(),
            channelTitle: zod_1.z.string(),
            thumbnails: zod_1.z.object({
                high: zod_1.z.object({
                    url: zod_1.z.string()
                }).optional(),
                default: zod_1.z.object({
                    url: zod_1.z.string()
                }).optional()
            }).optional()
        }),
        contentDetails: zod_1.z.object({
            duration: zod_1.z.string()
        }),
        status: zod_1.z.object({
            embeddable: zod_1.z.boolean()
        })
    }))
});
function parseISO8601Duration(duration) {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match)
        return 0;
    const hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2] || "0", 10);
    const seconds = parseInt(match[3] || "0", 10);
    return hours * 3600 + minutes * 60 + seconds;
}
class YouTubeService {
    static get apiKey() {
        const key = process.env.YOUTUBE_API_KEY;
        if (!key)
            throw new Error("YOUTUBE_API_KEY is missing");
        return key;
    }
    static async searchVideos(query, maxResults, pageToken) {
        const url = new URL("https://www.googleapis.com/youtube/v3/search");
        url.searchParams.set("key", this.apiKey);
        url.searchParams.set("part", "snippet");
        url.searchParams.set("type", "video");
        url.searchParams.set("videoEmbeddable", "true");
        url.searchParams.set("q", query);
        url.searchParams.set("maxResults", maxResults.toString());
        if (pageToken) {
            url.searchParams.set("pageToken", pageToken);
        }
        const res = await fetch(url.toString());
        if (!res.ok) {
            throw new Error(`YouTube API search error: ${res.status}`);
        }
        const data = await res.json();
        const parsed = youtubeSearchResponseSchema.parse(data);
        const songs = parsed.items.map(item => ({
            id: `youtube_${item.id.videoId}`,
            provider: "youtube",
            externalId: item.id.videoId,
            title: item.snippet.title,
            artist: item.snippet.channelTitle,
            album: "YouTube",
            duration: 0, // Search API doesn't return duration, so we use 0 transiently
            coverUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || "",
        }));
        return {
            songs,
            nextPageToken: parsed.nextPageToken
        };
    }
    static async getVideoById(id) {
        const url = new URL("https://www.googleapis.com/youtube/v3/videos");
        url.searchParams.set("key", this.apiKey);
        url.searchParams.set("part", "snippet,contentDetails,status");
        url.searchParams.set("id", id);
        const res = await fetch(url.toString());
        if (!res.ok) {
            throw new Error(`YouTube API videos list error: ${res.status}`);
        }
        const data = await res.json();
        const parsed = youtubeVideoResponseSchema.parse(data);
        if (parsed.items.length === 0) {
            throw new Error(`YouTube video not found: ${id}`);
        }
        const item = parsed.items[0];
        if (!item.status.embeddable) {
            throw new Error("VIDEO_NOT_EMBEDDABLE");
        }
        return {
            provider: "youtube",
            externalId: item.id,
            title: item.snippet.title,
            artist: item.snippet.channelTitle,
            album: "YouTube",
            duration: parseISO8601Duration(item.contentDetails.duration),
            coverUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || "",
        };
    }
}
exports.YouTubeService = YouTubeService;
//# sourceMappingURL=YouTubeService.js.map