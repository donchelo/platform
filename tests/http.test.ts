import { describe, it, expect } from "vitest"
import { withApiHandler } from "../src/http"
import { ValidationError } from "../src/errors"

describe("withApiHandler", () => {
  it("envuelve un resultado en JSON 200 con x-request-id", async () => {
    const route = withApiHandler(async () => ({ hello: "world" }))
    const res = await route(new Request("https://x/api/test"))
    expect(res.status).toBe(200)
    expect(res.headers.get("x-request-id")).toBeTruthy()
    expect(await res.json()).toEqual({ hello: "world" })
  })

  it("propaga el x-request-id entrante (trazabilidad entre capas)", async () => {
    const route = withApiHandler(async (_req, ctx) => ({ rid: ctx.requestId }))
    const res = await route(new Request("https://x/api/test", { headers: { "x-request-id": "trace-123" } }))
    expect(res.headers.get("x-request-id")).toBe("trace-123")
    expect((await res.json()).rid).toBe("trace-123")
  })

  it("clasifica AppError → respuesta uniforme con status/code/category", async () => {
    const route = withApiHandler(async () => {
      throw new ValidationError("falta el campo nombre")
    })
    const res = await route(new Request("https://x/api/test", { headers: { "x-request-id": "r1" } }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "falta el campo nombre",
      code: "VALIDATION_FAILED",
      category: "validation",
      requestId: "r1",
    })
  })

  it("error inesperado → 500 infraestructura, nunca silencioso", async () => {
    const route = withApiHandler(async () => {
      throw new Error("boom")
    })
    const res = await route(new Request("https://x/api/test"))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.category).toBe("infrastructure")
    expect(body.code).toBe("UNEXPECTED_ERROR")
  })

  it("requireModule sin sesión → 401", async () => {
    const route = withApiHandler(async () => ({ ok: true }), { requireModule: "kpis" })
    const res = await route(new Request("https://x/api/test"))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe("UNAUTHORIZED")
  })

  it("respeta una Response construida por el handler y le añade x-request-id", async () => {
    const route = withApiHandler(async () => new Response("raw", { status: 201 }))
    const res = await route(new Request("https://x/api/test", { headers: { "x-request-id": "r2" } }))
    expect(res.status).toBe(201)
    expect(res.headers.get("x-request-id")).toBe("r2")
    expect(await res.text()).toBe("raw")
  })
})
