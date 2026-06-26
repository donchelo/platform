"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.withApiHandler = withApiHandler;
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
const logger_1 = require("../logger");
const errors_1 = require("../errors");
/**
 * Garantiza el envío de logs en serverless SIN acoplar latencia: usa `after()` de
 * Next (corre tras enviar la respuesta, manteniendo la función viva hasta vaciar el
 * buffer). Si no hay runtime Next, hace un flush best-effort no bloqueante.
 */
async function scheduleFlush() {
    try {
        // Specifier no-literal a propósito: evita que tsc intente resolver "next/server"
        // (platform no depende de next; el módulo existe en la app consumidora).
        const moduleName = "next/server";
        const mod = (await Promise.resolve(`${moduleName}`).then(s => __importStar(require(s))));
        const after = (mod.after ?? mod.unstable_after);
        if (after) {
            after(() => (0, logger_1.flushLogs)());
            return;
        }
    }
    catch {
        // no estamos en runtime Next
    }
    void (0, logger_1.flushLogs)();
}
const auth_1 = require("../auth");
function jsonResponse(body, status, requestId) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "x-request-id": requestId },
    });
}
function withApiHandler(handler, options = {}) {
    const label = options.label ?? "api";
    return async (req, routeCtx) => {
        const requestId = req.headers.get("x-request-id") ?? (0, logger_1.newRequestId)();
        const log = (0, logger_1.getLogger)(label);
        return (0, logger_1.runWithContext)({ requestId }, async () => {
            const start = Date.now();
            const buildResponse = async () => {
                try {
                    // ── Auth (opcional) ──
                    let identity = null;
                    if (options.requireService) {
                        const result = (0, auth_1.verifyServiceRequest)(req, options.serviceAuth);
                        if (!result.ok) {
                            log.warn({ status: 401 }, `${label}: auth de servicio inválida`);
                            return jsonResponse({ error: "No autenticado", code: "UNAUTHORIZED", category: "validation", requestId }, 401, requestId);
                        }
                        if (result.tenantId)
                            (0, logger_1.setContextFields)({ tenant: result.tenantId });
                    }
                    if (options.requireModule || options.requireRole) {
                        identity = (0, auth_1.readIdentity)(req, options.sessionAuth);
                        if (identity)
                            (0, logger_1.setContextFields)({ tenant: identity.tenantId, userId: identity.userId });
                        if (options.requireModule)
                            (0, auth_1.requireModule)(identity, options.requireModule);
                        if (options.requireRole)
                            (0, auth_1.requireRole)(identity, options.requireRole);
                    }
                    else {
                        // Lee identidad si está disponible, pero no la exige.
                        identity = (0, auth_1.readIdentity)(req, options.sessionAuth);
                        if (identity)
                            (0, logger_1.setContextFields)({ tenant: identity.tenantId, userId: identity.userId });
                    }
                    // ── Handler ──
                    const ctx = { requestId, log, identity, ...(routeCtx ?? {}) };
                    const result = await handler(req, ctx);
                    const durationMs = Date.now() - start;
                    if (result instanceof Response) {
                        log.info({ durationMs, status: result.status }, label);
                        // Propaga el requestId aunque el handler haya construido su propia Response.
                        if (!result.headers.get("x-request-id"))
                            result.headers.set("x-request-id", requestId);
                        return result;
                    }
                    log.info({ durationMs, status: 200 }, label);
                    return jsonResponse(result, 200, requestId);
                }
                catch (err) {
                    const durationMs = Date.now() - start;
                    const appErr = (0, errors_1.classifyUnknownError)(err);
                    // Log con detalle completo (stack incluido); la respuesta al cliente es segura.
                    log.error({ durationMs, status: appErr.httpStatus, code: appErr.code, err: appErr.cause ?? appErr }, `${label} error`);
                    const { status, body } = (0, errors_1.toErrorResponse)(appErr, requestId);
                    return jsonResponse(body, status, requestId);
                }
            };
            const response = await buildResponse();
            // Asegura el envío de logs tras responder (serverless-safe, sin bloquear latencia).
            await scheduleFlush();
            return response;
        });
    };
}
