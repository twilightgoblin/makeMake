export declare class AppError extends Error {
    readonly statusCode: number;
    readonly code: string;
    constructor(statusCode: number, code: string, message: string);
}
export declare const invalidBody: (message: string) => AppError;
export declare const invalidDisplayName: () => AppError;
export declare const invalidPosition: () => AppError;
export declare const forbidden: (message?: string) => AppError;
export declare const notFound: (resource: string) => AppError;
export declare const conflict: (code: string, message: string) => AppError;
export declare const unprocessable: (code: string, message: string) => AppError;
export declare const tooManyRequests: (message?: string) => AppError;
//# sourceMappingURL=errors.d.ts.map