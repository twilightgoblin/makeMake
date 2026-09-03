export declare class YouTubeService {
    private static get apiKey();
    static searchVideos(query: string, maxResults: number, pageToken?: string): Promise<{
        songs: {
            id: string;
            provider: string;
            externalId: string;
            title: string;
            artist: string;
            album: string;
            duration: number;
            coverUrl: string;
        }[];
        nextPageToken: string | undefined;
    }>;
    static getVideoById(id: string): Promise<{
        provider: string;
        externalId: string;
        title: string;
        artist: string;
        album: string;
        duration: number;
        coverUrl: string;
    }>;
}
//# sourceMappingURL=YouTubeService.d.ts.map