# Scorecard de observabilidad — ecosistema superAI

> Fase 1 del [plan de auditoría de observabilidad](../../../.claude/plans/gleaming-snuggling-sifakis.md) (logs, error boundaries, mensajes de error, trazabilidad). Última corrida: **07-jul-2026**.

## Cómo re-ejecutar

```bash
cd Software/clients/AI4U/experiments/superAI
./platform/scripts/observability-scorecard.sh
```

Chequea, por repo, contra su **rama de producción real** (vía `git fetch` + `git show origin/<rama>`, no el checkout local que puede estar en otra rama) — sin instalar dependencias ni tocar working trees. Ver el script para el detalle exacto de cada columna.

## Causa raíz de la "telemetría ciega"

No es solo la versión de `@ai4u/platform`. Verificado por SQL directo contra Supabase (`platform_logs`, proyecto `superAI`): `sap-b1-backend` ya estaba en v0.2.3 con `PLATFORM_INGEST_URL`/`INGEST_SECRET` correctas y aun así tenía **cero** filas propias.

El motivo real: `withApiHandler` de `@ai4u/platform/http` es el único punto que dispara `waitUntil(flushLogs())` automáticamente. Sin él (o sin un flush explícito equivalente), el timer interno de 2s del logger casi nunca sobrevive al freeze de la función serverless tras responder — los logs quedan compuestos en memoria y se pierden. De los repos auditados, solo `mission-control-main` usa `withApiHandler` de forma consistente.

Bumpear la versión del paquete sin agregar flush explícito **no resuelve nada** — ver columna `flush_refs` de la tabla: mide si el repo dispara el flush por sí mismo (`withApiHandler`, `withLogFlush`, `waitUntil`), no solo si tiene la dependencia actualizada.

## Tabla (07-jul-2026)

| Repo | Rama prod | `@ai4u/platform` | `withApiHandler` | flush explícito | `global-error.tsx` | `error.tsx` | `console.*` en API |
|---|---|---|---|---|---|---|---|
| mission-control-main | main | v0.2.3 | 16 archivos | 0* | no | 0 | 6 |
| **sap-b1-backend** | master | **v0.2.3** | 0 | **8** (fix propio, PRs [#15](https://github.com/donchelo/sap-b1-backend/pull/15)/[#16](https://github.com/donchelo/sap-b1-backend/pull/16)) | no | 0 | 0 |
| magdalena-outreach | main | v0.2.0 | 15 archivos | 3 | no | 0 | 0 |
| kpis | master | v0.2.0 | 1 archivo | 0 | no | 0 | 0 |
| cobro-cartera | main | v0.2.0 | 0 | 2 | no | 0 | 2 |
| apify-service | master | v0.2.0 | 0 | 0 | no | 0 | 3 |
| changelog-service | main | v0.2.0 | 0 | 0 | no | 0 | 0 |
| content-machine | feat/content-machine-mvp | v0.2.0 | 0 | 0 | no | 0 | 0 |
| creador-clientes | master | v0.2.0 | 0 | 0 | no | 0 | 0 |
| desarrollo-articulos-tama | master | v0.2.0 | 0 | 0 | no | 0 | 0 |
| desarrollo-oc | main | v0.2.0 | 0 | 0 | no | 0 | 1 |
| magdalena-backend | main | v0.2.0 | 0 | 0 | no | 0 | 1 |
| magdalena-proyeccion | main | v0.2.0 | 0 | 0 | no | 0 | 3 |
| orderloader | main | v0.2.0 | 0 | 0 | no | 0 | 2 |
| planeador-produccion | master | v0.2.0 | 0 | 0 | no | 0 | 0 |
| sap-b1-chat | main | v0.2.0 | 0 | 0 | no | 0 | 1 |
| sabio-backend | main | v0.2.0 | 0 | 0 | no | 0 | 1 |
| share-of-voice | main | v0.2.0 | 0 | 0 | no | **1** | 3 |
| social-listening | main | v0.2.0 | 0 | 0 | no | 0 | 5 |
| solicitudes-desarrollo-tama | main | v0.2.0 | 0 | 0 | no | 0 | 0 |
| mission-control-admin | main | n/a (host del panel `/logs`) | 0 | 0 | no | 0 | 9 |
| mc-sso | master | n/a (dependencia de platform) | 0 | 0 | no | 0 | 0 |
| pre-flight | main | n/a (no adoptado) | 0 | 0 | no | 0 | 0 |

\* `mission-control-main` no referencia `flushLogs`/`waitUntil` directamente porque `withApiHandler` lo maneja internamente — el flush explícito por fuera del wrapper solo es necesario en repos con handlers propios (como sap-b1-backend antes del fix).

**cotizador-tama** (`tamaprint/cotizador-tama`, fuera de `@ai4u/platform`) se audita aparte como referencia frontend: tiene `global-error.tsx` + `error.tsx` con `error.digest` visible, logger JSON propio con `rid` de `x-vercel-id`, y `lib/errors.ts` con mensajes SAP accionables en español — es el modelo a replicar para la Fase 3.

## Lectura

- **18 de 20 repos** consumidores de `@ai4u/platform` siguen en v0.2.0 y sin ningún flush explícito propio — mismo problema que tenía sap-b1-backend antes de los PRs #15/#16.
- **Error boundaries casi ausentes en todo el ecosistema**: de 21 repos, solo `share-of-voice` tiene un `error.tsx` suelto; ninguno tiene `global-error.tsx`.
- `mission-control-main` y `magdalena-outreach` son los dos repos con adopción real de `withApiHandler`.

## Siguiente paso

Priorizar por tráfico entre los 18 repos restantes (candidatos evidentes: `kpis`, `orderloader`, `planeador-produccion` — todos con tráfico de producción diario) y replicar el patrón de `sap-b1-backend`: si el repo ya usa `withApiHandler`, no requiere cambios; si tiene handlers propios, envolver con `withLogFlush` (`@ai4u/platform/logger`, agregado en sap-b1-backend `lib/logger.ts`, portable a cualquier repo).
