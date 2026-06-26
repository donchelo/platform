/**
 * Wrapper uniforme para route handlers (Next App Router / Web Fetch).
 *
 * Generaliza withCapability de sap-b1-backend para CUALQUIER ruta:
 *   - Genera/propaga x-request-id (trazabilidad entre capas y servicios).
 *   - Abre el run-context del logger (requestId/tenant/userId/service heredados).
 *   - Aplica auth opcional (módulo / rol / servicio) antes del handler.
 *   - Mide duración, captura TODA excepción, la clasifica, la loguea y responde
 *     un JSON uniforme { error, code, category, requestId }. Nada de fallos silenciosos.
 *
 * Tipa contra Request/Response estándar de la Web (los route handlers de Next los
 * soportan), por lo que el paquete NO depende de `next`.
 */
import { getLogger, newRequestId, runWithContext, setContextFields, Logger } from "../logger"
import { toErrorResponse, classifyUnknownError } from "../errors"
import {
  readIdentity,
  requireModule,
  requireRole,
  verifyServiceRequest,
  type Identity,
  type SessionAuthConfig,
  type ServiceAuthConfig,
} from "../auth"

export interface ApiContext {
  requestId: string
  log: Logger
  /** Identidad del usuario si la ruta requiere/lee sesión; null en rutas de servicio o públicas. */
  identity: Identity | null
}

export interface WithApiHandlerOptions {
  /** Etiqueta para logs (p.ej. "GET sales analysis"). */
  label?: string
  /** Exige sesión + acceso a este módulo (any-of si es array). */
  requireModule?: string | string[]
  /** Exige sesión + este rol (any-of si es array). */
  requireRole?: string | string[]
  /** Exige auth de servicio (x-mc-secret / X-API-Key). */
  requireService?: boolean
  /** Config de sesión de usuario. */
  sessionAuth?: SessionAuthConfig
  /** Config de auth de servicio. */
  serviceAuth?: ServiceAuthConfig
}

type RouteHandler<R> = (req: Request, ctx: ApiContext & R) => Promise<unknown> | unknown

function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": requestId },
  })
}

export function withApiHandler<R extends object = object>(
  handler: RouteHandler<R>,
  options: WithApiHandlerOptions = {},
): (req: Request, routeCtx?: R) => Promise<Response> {
  const label = options.label ?? "api"
  return async (req: Request, routeCtx?: R): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? newRequestId()
    const log = getLogger(label)

    return runWithContext({ requestId }, async () => {
      const start = Date.now()
      try {
        // ── Auth (opcional) ──
        let identity: Identity | null = null

        if (options.requireService) {
          const result = verifyServiceRequest(req, options.serviceAuth)
          if (!result.ok) {
            log.warn({ status: 401 }, `${label}: auth de servicio inválida`)
            return jsonResponse(
              { error: "No autenticado", code: "UNAUTHORIZED", category: "validation", requestId },
              401,
              requestId,
            )
          }
          if (result.tenantId) setContextFields({ tenant: result.tenantId })
        }

        if (options.requireModule || options.requireRole) {
          identity = readIdentity(req, options.sessionAuth)
          if (identity) setContextFields({ tenant: identity.tenantId, userId: identity.userId })
          if (options.requireModule) requireModule(identity, options.requireModule)
          if (options.requireRole) requireRole(identity, options.requireRole)
        } else {
          // Lee identidad si está disponible, pero no la exige.
          identity = readIdentity(req, options.sessionAuth)
          if (identity) setContextFields({ tenant: identity.tenantId, userId: identity.userId })
        }

        // ── Handler ──
        const ctx = { requestId, log, identity, ...(routeCtx ?? ({} as R)) } as ApiContext & R
        const result = await handler(req, ctx)

        const durationMs = Date.now() - start
        if (result instanceof Response) {
          log.info({ durationMs, status: result.status }, label)
          // Propaga el requestId aunque el handler haya construido su propia Response.
          if (!result.headers.get("x-request-id")) result.headers.set("x-request-id", requestId)
          return result
        }
        log.info({ durationMs, status: 200 }, label)
        return jsonResponse(result, 200, requestId)
      } catch (err) {
        const durationMs = Date.now() - start
        const appErr = classifyUnknownError(err)
        // Log con detalle completo (stack incluido); la respuesta al cliente es segura.
        log.error({ durationMs, status: appErr.httpStatus, code: appErr.code, err: appErr.cause ?? appErr }, `${label} error`)
        const { status, body } = toErrorResponse(appErr, requestId)
        return jsonResponse(body, status, requestId)
      }
    })
  }
}
