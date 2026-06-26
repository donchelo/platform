"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readIdentity = readIdentity;
exports.isModuleAllowed = isModuleAllowed;
exports.hasRole = hasRole;
exports.isAdmin = isAdmin;
exports.requireModule = requireModule;
exports.requireRole = requireRole;
exports.verifyServiceRequest = verifyServiceRequest;
/**
 * Auth uniforme para todo el ecosistema: identidad + permisos.
 *
 * Dos modos:
 *   1. Sesión de usuario (apps con SSO): readIdentity() lee la cookie de sesión,
 *      la verifica con @ai4u/mc-sso y devuelve { tenantId, userId, roles,
 *      allowedModules }. Los permisos viajan EMBEBIDOS en el mc-token desde el
 *      handoff de Mission Control, así ninguna app necesita tocar la BD.
 *   2. Servicio↔servicio (backends): verifyServiceRequest() unifica los tres
 *      esquemas actuales (x-mc-secret compartido / X-API-Key por tenant).
 *
 * La regla de visibilidad de módulos es la misma de mission-control-main/lib/access.ts:
 * sin lista (null/[]) ⇒ ve todo; con lista ⇒ solo esos ids.
 */
const mc_sso_1 = require("@ai4u/mc-sso");
const errors_1 = require("../errors");
function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(";")) {
        const i = part.indexOf("=");
        if (i === -1)
            continue;
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}
/** Lee y verifica la identidad del usuario desde la cookie de sesión. null si no hay/no es válida. */
function readIdentity(req, cfg = {}) {
    const cookieName = cfg.cookieName ?? "mc_session";
    const secret = cfg.secret ?? process.env.MISSION_CONTROL_SECRET;
    if (!secret)
        return null;
    const token = parseCookies(req.headers.get("cookie"))[cookieName];
    if (!token)
        return null;
    const data = (0, mc_sso_1.verifySession)(token, secret);
    if (!data)
        return null;
    return {
        tenantId: data.tenantId,
        userId: data.userId,
        roles: data.roles,
        allowedModules: data.allowedModules ?? null,
        displayName: data.displayName,
    };
}
/* ── Permisos (misma regla que access.ts) ────────────────────────────────── */
function isModuleAllowed(moduleId, allowedModules) {
    if (!allowedModules || allowedModules.length === 0)
        return true;
    return allowedModules.includes(moduleId);
}
function hasRole(identity, role) {
    return !!identity?.roles?.includes(role);
}
function isAdmin(identity) {
    return hasRole(identity, "admin");
}
/**
 * Exige identidad y acceso a un módulo (acepta varios: any-of). Lanza errores
 * tipados que el wrapper HTTP convierte en 401/403 uniformes.
 */
function requireModule(identity, moduleId) {
    if (!identity)
        throw new errors_1.UnauthorizedError();
    const ids = Array.isArray(moduleId) ? moduleId : [moduleId];
    if (!ids.some((id) => isModuleAllowed(id, identity.allowedModules))) {
        throw new errors_1.ForbiddenError("No autorizado para este módulo");
    }
    return identity;
}
function requireRole(identity, role) {
    if (!identity)
        throw new errors_1.UnauthorizedError();
    const roles = Array.isArray(role) ? role : [role];
    if (!roles.some((r) => hasRole(identity, r))) {
        throw new errors_1.ForbiddenError("Rol insuficiente");
    }
    return identity;
}
/** Valida auth de servicio (x-mc-secret o X-API-Key). Comparación de longitud constante simple. */
function verifyServiceRequest(req, cfg = {}) {
    const sharedSecret = cfg.sharedSecret ?? process.env.MISSION_CONTROL_SECRET;
    const mcSecret = req.headers.get("x-mc-secret");
    if (sharedSecret && mcSecret && safeEqual(mcSecret, sharedSecret))
        return { ok: true };
    const apiKey = req.headers.get("x-api-key");
    if (apiKey && cfg.apiKeys) {
        for (const [tenantId, key] of Object.entries(cfg.apiKeys)) {
            if (key && safeEqual(apiKey, key))
                return { ok: true, tenantId };
        }
    }
    return { ok: false };
}
/** Comparación en tiempo (aprox.) constante sin node:crypto, segura para Edge Runtime. */
function safeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
