import { z } from "zod";

const youtubeSearchResponseSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(z.object({
    id: z.object({
      videoId: z.string()
    }),
    snippet: z.object({
      title: z.string(),
      channelTitle: z.string(),
      thumbnails: z.object({
        high: z.object({
          url: z.string()
        }).optional(),
        default: z.object({
          url: z.string()
        }).optional()
      }).optional()
    })
  }))
});

const youtubeVideoResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    snippet: z.object({
      title: z.string(),
      channelTitle: z.string(),
      thumbnails: z.object({
        high: z.object({
          url: z.string()
        }).optional(),
        default: z.object({
          url: z.string()
        }).optional()
      }).optional()
    }),
    contentDetails: z.object({
      duration: z.string()
    }),
    status: z.object({
      embeddable: z.boolean()
    })
  }))
});

function parseISO8601Duration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

export class YouTubeService {
  private static get apiKey() {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) throw new Error("YOUTUBE_API_KEY is missing");
    return key;
  }

  static async searchVideos(query: string, maxResults: number, pageToken?: string) {
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

  static async getVideoById(id: string) {
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
