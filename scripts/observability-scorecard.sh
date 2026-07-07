#!/usr/bin/env bash
# Scorecard de observabilidad del ecosistema superAI.
#
# Chequea, por repo, contra su rama de producción REAL (no el checkout local,
# que puede estar en otra rama) — vía `git show`, sin instalar dependencias
# ni tocar working trees:
#   - versión de @ai4u/platform en package.json
#   - referencias a withApiHandler (único disparador de flushLogs en @ai4u/platform/http)
#   - referencias a flushLogs/waitUntil/withLogFlush fuera de node_modules
#   - presencia de app/global-error.tsx
#   - cantidad de error.tsx bajo app/
#   - console.* en rutas app/api/**
#
# Uso: correr desde el directorio que contiene los repos hermanos, p.ej.
#   cd Software/clients/AI4U/experiments/superAI && ./platform/scripts/observability-scorecard.sh
#
# Salida: TSV en stdout (repo, default, platform_ver, withApiHandler_files,
# flush_refs, has_global_error, error_tsx_count, console_in_api).
#
# Ver plan de auditoría (~/.claude/plans/gleaming-snuggling-sifakis.md) y
# OBSERVABILITY-SCORECARD.md en este repo para el contexto y la línea base.

set -euo pipefail

REPOS=(
  apify-service changelog-service cobro-cartera content-machine creador-clientes
  desarrollo-articulos-tama desarrollo-oc kpis magdalena-backend magdalena-outreach
  magdalena-proyeccion mission-control-admin mission-control-main orderloader
  planeador-produccion sap-b1-backend sap-b1-chat sabio-backend share-of-voice
  social-listening solicitudes-desarrollo-tama mc-sso pre-flight
)

echo -e "repo\tdefault\tplatform_ver\twithApiHandler_files\tflush_refs\thas_global_error\terror_tsx_count\tconsole_in_api"

for d in "${REPOS[@]}"; do
  if [ ! -d "$d/.git" ]; then
    echo -e "$d\tNOREPO\t-\t-\t-\t-\t-\t-"
    continue
  fi
  (
    set +e
    cd "$d"
    # Sin este fetch, origin/<rama> puede estar desactualizado respecto al
    # remoto (visto en producción: un merge reciente no se reflejaba hasta
    # hacer fetch explícito) y el scorecard reporta versiones viejas.
    git fetch origin --quiet >/dev/null 2>&1
    git remote set-head origin -a >/dev/null 2>&1
    def=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's#refs/remotes/origin/##')
    if [ -z "$def" ]; then
      def=$(git remote show origin 2>/dev/null | grep -i "Rama HEAD\|HEAD branch" | awk '{print $NF}')
    fi

    ver=$(git show "origin/$def:package.json" 2>/dev/null | grep -o '"@ai4u/platform": *"[^"]*"' | grep -o 'v[0-9.]*')
    wah=$(git grep -c "withApiHandler" "origin/$def" 2>/dev/null | grep -vc node_modules)
    flush=$(git grep -c "flushLogs\|waitUntil\|withLogFlush" "origin/$def" 2>/dev/null | grep -vc node_modules)
    if git cat-file -e "origin/$def:app/global-error.tsx" 2>/dev/null; then ge=yes; else ge=no; fi
    et=$(git ls-tree -r --name-only "origin/$def" 2>/dev/null | grep -c "app/.*error\.tsx$")
    ci=$(git grep -c "console\." "origin/$def" -- 'app/api/**' 2>/dev/null | grep -vc node_modules)

    echo -e "$d\t$def\t${ver:-none}\t${wah:-0}\t${flush:-0}\t$ge\t${et:-0}\t${ci:-0}"
  )
done
