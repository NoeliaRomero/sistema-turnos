# 10 — SUBHILO: BUGS, DEBUGGING Y REFACTORS

> Subhilo transversal. Puede tocar cualquier módulo para corregir errores, pero
> bajo reglas estrictas de coordinación (es el subhilo con mayor riesgo de conflicto).

---

## Objetivo
Corregir errores, hacer debugging y refactors de bajo riesgo sin introducir regresiones
ni cambiar funcionalidad sin acuerdo.

## Alcance
- Corrección de bugs reportados en cualquier módulo.
- Refactors internos que NO cambian comportamiento observable.
- Mejora de manejo de errores y mensajes.

## Responsabilidades
- Reproducir el bug antes de tocar código.
- Identificar la causa raíz (no parches).
- Verificar que el fix no rompe otros módulos.
- Documentar cada fix (qué, dónde, por qué).

## Carpetas afectadas
Potencialmente todas, pero con prioridad de lectura sobre escritura:
- `server/routes/`, `server/db/`, `server/middleware/`
- `public/js/`, `public/*.html`
- `electron/`

## Riesgos
- **Alto riesgo de conflicto** con todos los demás subhilos (toca lo mismo).
- Un refactor puede romper la red local, el licenciamiento o el build.

## Dependencias
- Depende del conocimiento de TODOS los subhilos.
- Debe avisar al subhilo dueño del módulo antes de un cambio no trivial.

## Qué PUEDE modificar
- Líneas de código con bug confirmado.
- Manejo de errores, validaciones, mensajes.

## Qué NO PUEDE modificar
- Esquema de la base de datos sin acuerdo con el subhilo dueño.
- Lógica de licenciamiento (`electron/license.js`, `tools/`) sin acuerdo con subhilo de licencias.
- Configuración de build (`package.json` → `build`) sin acuerdo.

## Coordinación con otros subhilos
- Antes de tocar un archivo "propiedad" de otro subhilo (ver matriz en `90`), abrir
  un comentario/issue describiendo el bug y el fix propuesto.
- Los fixes que cruzan módulos requieren revisión cruzada.

## Criterios de aceptación
- El bug ya no se reproduce.
- Ningún test/flujo existente se rompe.
- El `.exe` sigue compilando (`electron-builder --win --x64`).

## Estrategia de testing
- Reproducir el flujo manualmente en modo dev (`npm run dev`).
- Probar en los 4 roles afectados si aplica.
- Verificar red local (PC + celular) si el fix toca el servidor.

## Estrategia de debugging
Ver `92-GUIA-DE-DEBUGGING.md`. Resumen:
- Logs de Electron en consola del main process.
- DevTools en modo dev (`NODE_ENV=development`).
- Inspeccionar SQLite con DB Browser for SQLite.

## Bugs históricos ya resueltos (referencia)
| Bug | Causa | Fix |
|-----|-------|-----|
| Dropdown de juegos vacío en recepción | Falta `'recepcion'` en `requireAuth` | Agregado el rol |
| Recepción disparaba notificación de operador | Emisión sin chequear rol | `if rol === 'operador'` |
| Activación no abría el sistema | `location.reload()` en vez de IPC | `notifyActivationSuccess()` |
| Licencia en carpeta equivocada | `SistemaTurnos` vs `sistema-turnos` | Ruta corregida a `flowturn` |
| Acceso directo apuntaba a carpeta dev | Shortcut mal generado | Recreado apuntando al exe instalado |
| Encoding roto en HTML por PowerShell | Replace sin UTF-8 | Reescritura con UTF8Encoding sin BOM |
