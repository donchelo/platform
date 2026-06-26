import { describe, it, expect } from "vitest"
import {
  AppError,
  ValidationError,
  BusinessError,
  InfrastructureError,
  NotFoundError,
  ForbiddenError,
  classifyUnknownError,
  toErrorResponse,
  isAppError,
} from "../src/errors"

describe("errores tipados", () => {
  it("asigna categoría, status y code por defecto", () => {
    expect(new ValidationError("x").category).toBe("validation")
    expect(new ValidationError("x").httpStatus).toBe(400)
    expect(new BusinessError("x").httpStatus).toBe(409)
    expect(new InfrastructureError("x").httpStatus).toBe(502)
    expect(new InfrastructureError("x").isOperational).toBe(false)
  })

  it("los atajos heredan categoría correcta", () => {
    expect(new NotFoundError().httpStatus).toBe(404)
    expect(new NotFoundError().category).toBe("business")
    expect(new ForbiddenError().httpStatus).toBe(403)
  })

  it("permite override de code/status", () => {
    const e = new ValidationError("campo", { code: "BAD_FIELD", httpStatus: 422 })
    expect(e.code).toBe("BAD_FIELD")
    expect(e.httpStatus).toBe(422)
  })

  it("isAppError discrimina", () => {
    expect(isAppError(new AppError("x", "business"))).toBe(true)
    expect(isAppError(new Error("x"))).toBe(false)
  })

  it("classifyUnknownError envuelve lo desconocido en 500 infra", () => {
    const e = classifyUnknownError(new Error("boom"))
    expect(e.category).toBe("infrastructure")
    expect(e.httpStatus).toBe(500)
    expect(e.code).toBe("UNEXPECTED_ERROR")
    expect(e.message).toBe("boom")
  })

  it("respeta un AppError ya tipado", () => {
    const original = new BusinessError("regla")
    expect(classifyUnknownError(original)).toBe(original)
  })

  it("toErrorResponse produce cuerpo uniforme con requestId", () => {
    const { status, body } = toErrorResponse(new ValidationError("falta nombre"), "abc123")
    expect(status).toBe(400)
    expect(body).toEqual({
      error: "falta nombre",
      code: "VALIDATION_FAILED",
      category: "validation",
      requestId: "abc123",
    })
  })
})
