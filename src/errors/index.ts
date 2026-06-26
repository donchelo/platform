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

export type ErrorCategory = "validation" | "business" | "infrastructure"

export interface AppErrorOptions {
  /** Código estable y legible por máquina, p.ej. "VALIDATION_FAILED", "SAP_UNREACHABLE". */
  code?: string
  /** Status HTTP a devolver. */
  httpStatus?: number
  /** Datos seguros para el cliente (no incluir secretos ni internals). */
  details?: unknown
  /** Causa original (para logging; nunca se serializa al cliente). */
  cause?: unknown
  /**
   * `true` = error esperado/operacional (se loguea como WARN/ERROR controlado).
   * `false` = bug inesperado (siempre ERROR + stack completo).
   */
  isOperational?: boolean
}

/** Base de toda la jerarquía. Llevar siempre `category`, `httpStatus` y `code`. */
export class AppError extends Error {
  readonly category: ErrorCategory
  readonly httpStatus: number
  readonly code: string
  readonly details?: unknown
  readonly isOperational: boolean
  /** Causa original (para logging; nunca se serializa al cliente). */
  readonly cause?: unknown

  constructor(message: string, category: ErrorCategory, opts: AppErrorOptions = {}) {
    super(message)
    this.name = new.target.name
    this.category = category
    this.httpStatus = opts.httpStatus ?? defaultStatusFor(category)
    this.code = opts.code ?? defaultCodeFor(category)
    this.details = opts.details
    this.cause = opts.cause
    this.isOperational = opts.isOperational ?? true
    // Mantener el stack apuntando al call-site real.
    Error.captureStackTrace?.(this, new.target)
  }
}

function defaultStatusFor(category: ErrorCategory): number {
  switch (category) {
    case "validation": return 400
    case "business": return 409
    case "infrastructure": return 502
  }
}

function defaultCodeFor(category: ErrorCategory): string {
  switch (category) {
    case "validation": return "VALIDATION_FAILED"
    case "business": return "BUSINESS_RULE_VIOLATION"
    case "infrastructure": return "INFRASTRUCTURE_ERROR"
  }
}

/* ── Subclases por categoría ─────────────────────────────────────────────── */

export class ValidationError extends AppError {
  constructor(message: string, opts: AppErrorOptions = {}) {
    super(message, "validation", { httpStatus: 400, code: "VALIDATION_FAILED", ...opts })
  }
}

export class BusinessError extends AppError {
  constructor(message: string, opts: AppErrorOptions = {}) {
    super(message, "business", { httpStatus: 409, code: "BUSINESS_RULE_VIOLATION", ...opts })
  }
}

export class InfrastructureError extends AppError {
  constructor(message: string, opts: AppErrorOptions = {}) {
    super(message, "infrastructure", { httpStatus: 502, code: "INFRASTRUCTURE_ERROR", isOperational: false, ...opts })
  }
}

/* ── Atajos comunes (subtipos con status/codes convencionales) ───────────── */

export class NotFoundError extends BusinessError {
  constructor(message = "Recurso no encontrado", opts: AppErrorOptions = {}) {
    super(message, { httpStatus: 404, code: "NOT_FOUND", ...opts })
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "No autenticado", opts: AppErrorOptions = {}) {
    super(message, "validation", { httpStatus: 401, code: "UNAUTHORIZED", ...opts })
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "No autorizado", opts: AppErrorOptions = {}) {
    super(message, "business", { httpStatus: 403, code: "FORBIDDEN", ...opts })
  }
}

export class ConflictError extends BusinessError {
  constructor(message = "Conflicto de estado", opts: AppErrorOptions = {}) {
    super(message, { httpStatus: 409, code: "CONFLICT", ...opts })
  }
}

export class ExternalServiceError extends InfrastructureError {
  constructor(message = "Servicio externo no disponible", opts: AppErrorOptions = {}) {
    super(message, { httpStatus: 502, code: "EXTERNAL_SERVICE_ERROR", ...opts })
  }
}

/* ── Clasificación de lo desconocido ─────────────────────────────────────── */

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError
}

/**
 * Convierte cualquier `unknown` en un AppError. Lo que no reconozca se trata como
 * fallo de infraestructura inesperado (500), nunca se ignora.
 */
export function classifyUnknownError(err: unknown): AppError {
  if (isAppError(err)) return err
  const message = err instanceof Error ? err.message : String(err)
  return new InfrastructureError(message, {
    httpStatus: 500,
    code: "UNEXPECTED_ERROR",
    isOperational: false,
    cause: err,
  })
}

export interface ErrorResponseBody {
  error: string
  code: string
  category: ErrorCategory
  requestId?: string
  details?: unknown
}

/** Cuerpo JSON uniforme y seguro para responder al cliente. */
export function toErrorResponse(
  err: unknown,
  requestId?: string,
): { status: number; body: ErrorResponseBody } {
  const appErr = classifyUnknownError(err)
  return {
    status: appErr.httpStatus,
    body: {
      error: appErr.message,
      code: appErr.code,
      category: appErr.category,
      ...(requestId ? { requestId } : {}),
      ...(appErr.details !== undefined ? { details: appErr.details } : {}),
    },
  }
}
