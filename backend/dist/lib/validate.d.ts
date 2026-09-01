/** Validates and trims a display name. Throws 400 on failure. */
export declare function validateDisplayName(raw: unknown): string;
/** Asserts a field is a non-empty string. */
export declare function requireString(value: unknown, field: string): string;
/** Asserts a field is a non-negative integer. */
export declare function requireNonNegativeInt(value: unknown, field: string): number;
/** Parses a playlist position, must be >= 0. */
export declare function parsePosition(value: unknown): number;
export interface PaginationParams {
    limit: number;
    offset: number;
}
/** Parses ?limit and ?offset from query string, with sensible defaults. */
export declare function parsePagination(query: Record<string, unknown>, maxLimit?: number, defaultLimit?: number): PaginationParams;
//# sourceMappingURL=validate.d.ts.map