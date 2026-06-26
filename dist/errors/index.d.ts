/**
 * Errores tipados y categorizados para todo el ecosistema superAI.
 *
 * Tres categorías (las que pidió el usuario):
 *   - "validation"     → entrada inválida del cliente (400)
 *   - "business"       → regla de negocio violada / conflicto de estado (409/422)
 *   - "infrastructure" → fallo de un sistema externo o del propio servicio (5xx)
 *
 * Generaliza el `classifySapError` de sap-b1-backend para que cualquier app
 * responda errores de forma uniforme y NUNCA falle en silencio.
 */
export type ErrorCategory = "validation" | "business" | "infrastructure";
export interface AppErrorOptions {
    /** Código estable y legible por máquina, p.ej. "VALIDATION_FAILED", "SAP_UNREACHABLE". */
    code?: string;
    /** Status HTTP a devolver. */
    httpStatus?: number;
    /** Datos seguros para el cliente (no incluir secretos ni internals). */
    details?: unknown;
    /** Causa original (para logging; nunca se serializa al cliente). */
    cause?: unknown;
    /**
     * `true` = error esperado/operacional (se loguea como WARN/ERROR controlado).
     * `false` = bug inesperado (siempre ERROR + stack completo).
     */
    isOperational?: boolean;
}
/** Base de toda la jerarquía. Llevar siempre `category`, `httpStatus` y `code`. */
export declare class AppError extends Error {
    readonly category: ErrorCategory;
    readonly httpStatus: number;
    readonly code: string;
    readonly details?: unknown;
    readonly isOperational: boolean;
    /** Causa original (para logging; nunca se serializa al cliente). */
    readonly cause?: unknown;
    constructor(message: string, category: ErrorCategory, opts?: AppErrorOptions);
}
export declare class ValidationError extends AppError {
    constructor(message: string, opts?: AppErrorOptions);
}
export declare class BusinessError extends AppError {
    constructor(message: string, opts?: AppErrorOptions);
}
export declare class InfrastructureError extends AppError {
    constructor(message: string, opts?: AppErrorOptions);
}
export declare class NotFoundError extends BusinessError {
    constructor(message?: string, opts?: AppErrorOptions);
}
export declare class UnauthorizedError extends AppError {
    constructor(message?: string, opts?: AppErrorOptions);
}
export declare class ForbiddenError extends AppError {
    constructor(message?: string, opts?: AppErrorOptions);
}
export declare class ConflictError extends BusinessError {
    constructor(message?: string, opts?: AppErrorOptions);
}
export declare class ExternalServiceError extends InfrastructureError {
    constructor(message?: string, opts?: AppErrorOptions);
}
export declare function isAppError(err: unknown): err is AppError;
/**
 * Convierte cualquier `unknown` en un AppError. Lo que no reconozca se trata como
 * fallo de infraestructura inesperado (500), nunca se ignora.
 */
export declare function classifyUnknownError(err: unknown): AppError;
export interface ErrorResponseBody {
    error: string;
    code: string;
    category: ErrorCategory;
    requestId?: string;
    details?: unknown;
}
/** Cuerpo JSON uniforme y seguro para responder al cliente. */
export declare function toErrorResponse(err: unknown, requestId?: string): {
    status: number;
    body: ErrorResponseBody;
};
//# sourceMappingURL=index.d.ts.map