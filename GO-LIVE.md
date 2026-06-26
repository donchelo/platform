# Go-Live — preocupaciones transversales (`@ai4u/platform`)

Todo el código está listo y con type-check verde. Estos son los pasos **humanos** para
ponerlo en producción (requieren publicar paquetes, tocar Supabase prod, env y deploy).

## 1. Publicar los paquetes

### `@ai4u/mc-sso` (ya es repo `donchelo/mc-sso`)
Tiene cambios sin publicar (campos opcionales en token/session). Desde `superAI/mc-sso`:
```bash
npm run build && npm test
git add -A && git commit -m "feat: identidad+permisos opcionales en token/session"
git tag v1.1.0 && git push origin main --tags
```

### `@ai4u/platform` (repo nuevo `donchelo/platform`)
Desde `superAI/platform` (dist ya construido y commiteable):
```bash
npm run build && npm test          # 17 tests verde
git init && git add -A && git commit -m "v0.1.0: logger + errores + http + auth"
git branch -M main
git remote add origin https://github.com/donchelo/platform.git   # crear el repo primero
git tag v0.1.0 && git push -u origin main --tags
```

### Reinstalar en consumidores
En cada app integrada (ver lista abajo), reemplazar el overlay local por el paquete real:
```bash
npm install            # toma @ai4u/platform y @ai4u/mc-sso desde GitHub (package.json ya pinea)
```
> Importante: durante el desarrollo se usó `npm install --no-save ../platform [../mc-sso]`,
> que pudo podar dev-deps. Un `npm install` limpio restaura todo.

## 2. Migración Supabase (proyecto MC `gnhefpltfrnyeutoyjxs`)

Aplicar `mission-control-main/supabase/migrations/20260626000000_platform_logs.sql`
(tabla `platform_logs` + `prune_platform_logs` + `platform_logs_metrics`). Con Supabase CLI:
```bash
supabase db push      # o aplicar el SQL desde el dashboard
```

## 3. Variables de entorno

- **Panel admin (`mission-control-admin`)**: `INGEST_SECRET` (secreto compartido),
  `CRON_SECRET` (para el cron de retención), opcional `PLATFORM_LOGS_RETENTION_DAYS` (default 30).
- **Cada app que envía logs**: `INGEST_SECRET` (igual al del admin),
  `PLATFORM_INGEST_URL=https://<admin>/api/ingest/logs`, y `LOG_FORMAT=json`.

## 4. Deploy

Deployar `mission-control-admin` (panel + ingest + cron) y las apps integradas. El cron de
retención corre solo (vercel.json → `/api/cron/prune-logs`, diario 03:00).

## 5. Verificación end-to-end

1. Forzá un error en una app integrada (p.ej. pegarle a `/api/kpis` sin sesión válida).
2. Abrí el panel admin → **Logs**: debe aparecer el registro con su `request_id`.
3. → **Errores**: el ERROR debe listarse; marcalo "Resuelto".
4. → **Métricas**: el contador de errores y el volumen por servicio deben reflejarlo.
5. Confirmá que un usuario con `allowed_modules` restringido recibe 403 en la ruta gateada.

## Apps integradas (type-check verde)

- **Pilotos**: kpis, sap-b1-backend, orderloader
- **SSO**: creador-clientes, planeador-produccion, sap-b1-chat, desarrollo-oc,
  desarrollo-articulos-tama, solicitudes-desarrollo-tama, magdalena-proyeccion,
  content-machine, share-of-voice, social-listening
- **Backend**: sabio-backend, changelog-service, magdalena-backend, apify-service, cobro-cartera
- **Hub**: mission-control-main (observabilidad propia + handoff con permisos)
- **Panel**: mission-control-admin (ingest, visores, métricas, roles, cron de retención)

## Pendiente para una iteración futura (no bloquea el go-live)
- Unificar la auth servicio↔servicio (`verifyServiceRequest`) en los backends que aún usan
  chequeos ad-hoc de `x-mc-secret`/`x-internal-secret`/API key.
- Migrar los `console.*` sueltos restantes a `getLogger` donde aporte valor.
