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
 * soportan), por lo que el paquete no depende de `next`. Sí depende de
 * `@vercel/functions` para el flush de logs sin bloquear la respuesta (agnóstico
 * de framework, pero requiere correr sobre una función de Vercel).
 */
import { getLogger, newRequestId, runWithContext, setContextFields, flushLogs, Logger } from "../logger"
import { toErrorResponse, classifyUnknownError } from "../errors"
import { waitUntil } from "@vercel/functions"

/**
 * Garantiza el envío de logs en serverless SIN acoplar latencia: usa `waitUntil()`
 * de @vercel/functions, que extiende la vida de la función hasta que la promesa
 * resuelva sin bloquear la respuesta al cliente.
 *
 * BUG histórico (jul-2026): la versión anterior intentaba `import("next/server")`
 * con un specifier NO literal (una variable) para evitar que `platform` dependiera
 * de Next.js en tiempo de build. Pero Turbopack/webpack no pueden analizar
 * estáticamente un import con nombre dinámico: en vez de dejarlo resolver en
 * runtime, lo REEMPLAZAN por un throw sintético ("Cannot find module as
 * expression is too dynamic") que dispara SIEMPRE. El catch (vacío) lo absorbía
 * silenciosamente y caía a `void flushLogs()` sin esperar — en serverless, la
 * función se congela apenas responde, así que el fetch de ingesta nunca llegaba
 * a completarse ni a fallar visiblemente. Resultado: platform_logs se quedaba
 * vacía en TODAS las apps del ecosistema aunque el logger corriera bien.
 * `waitUntil` es un import ESTÁTICO (analizable por cualquier bundler) y
 * agnóstico de framework — funciona igual en Next.js, Express, etc. sobre Vercel.
 */
async function scheduleFlush(): Promise<void> {
  try {
    waitUntil(flushLogs())
  } catch {
    // No estamos en una función Vercel activa (p.ej. tests, scripts locales):
    // flush best-effort sin bloquear.
    void flushLogs()
  }
}
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
      const buildResponse = async (): Promise<Response> => {
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
      }

      const response = await buildResponse()
      // Asegura el envío de logs tras responder (serverless-safe, sin bloquear latencia).
      await scheduleFlush()
      return response
    })
  }
}
