/**
 * @ai4u/platform — preocupaciones transversales del ecosistema superAI.
 *
 * Subpaths recomendados (tree-shaking + claridad):
 *   import { getLogger } from "@ai4u/platform/logger"
 *   import { ValidationError } from "@ai4u/platform/errors"
 *   import { withApiHandler } from "@ai4u/platform/http"
 *   import { readIdentity, requireModule } from "@ai4u/platform/auth"
 *
 * Este barrel re-exporta todo para quien prefiera un único import.
 */
export * from "./logger";
export * from "./errors";
export * from "./auth";
export * from "./http";
//# sourceMappingURL=index.d.ts.map