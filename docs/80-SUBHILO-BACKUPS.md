# 80 — SUBHILO: BACKUPS, EXPORTACIÓN E IMPORTACIÓN

> ❌ **Estado: NO IMPLEMENTADO.** Esta funcionalidad no se desarrolló en esta
> conversación. Este documento define el módulo como **pendiente** y propone el diseño,
> sin inventar que ya existe.

---

## Objetivo
Proteger los datos del cliente mediante backups, exportación, importación y recuperación.

## Situación actual (lo que SÍ existe hoy)
- La base de datos vive en `AppData/Roaming/flowturn/turnos.db` (+ `-shm`, `-wal`).
- Existe **migración automática** de datos entre versiones (`sistema-turnos` → `flowturn`)
  en `electron/main.js`. Esto NO es un backup, es una migración de una sola vez.
- No hay backup programado, ni exportación, ni importación, ni recuperación.

## Alcance PROPUESTO (pendiente de desarrollo)
- Backup manual: botón "Exportar base de datos" en el panel admin → copia `turnos.db`.
- Backup automático: copia periódica de `turnos.db` a una subcarpeta `backups/`.
- Exportación de datos a CSV/Excel (turnos, estadísticas).
- Importación / restauración desde un archivo de backup.
- Protección: backups cifrados (opcional).

## Responsabilidades (cuando se desarrolle)
- Copiar de forma segura el archivo SQLite (respetando WAL: hacer checkpoint antes).
- Versionar los backups con timestamp.
- Validar integridad al restaurar.

## Carpetas / archivos afectados (propuesto)
- `electron/backup.js` (nuevo) — lógica de copia/restauración.
- `server/routes/backup.js` (nuevo) — endpoints de exportación.
- `public/admin.html` / `public/js/admin.js` — UI de backup.

## Riesgos
- **Corrupción de SQLite** si se copia el `.db` con transacciones abiertas (WAL).
  → Hacer `PRAGMA wal_checkpoint` antes de copiar.
- Restaurar un backup incompatible con una versión nueva del esquema.
- Backups con datos sensibles sin cifrar.

## Dependencias
- Necesita conocer el esquema completo (de `20` y `40`).
- Debe incluir logs (`50`) en los backups.
- Coordinar con `93-COMPILACION` para no incluir backups en el instalador.

## Qué PUEDE modificar
- Nuevos archivos de backup/exportación.
- UI de backup en admin.

## Qué NO PUEDE modificar
- El esquema de datos (solo lo lee/copia).
- La lógica de negocio.

## Coordinación con otros subhilos
- Avisar a `20` y `40` ante cualquier cambio de esquema para mantener compatibilidad
  de restauración.
- Coordinar con `50` para incluir auditoría en los backups.

## Criterios de aceptación
- Se puede generar un backup válido y restaurarlo sin pérdida.
- El backup respeta WAL (checkpoint previo).
- La exportación a CSV/Excel abre correctamente.

## Estrategia de testing
- Generar backup, borrar datos, restaurar, verificar integridad.
- Probar exportación con datos reales.

## Estrategia de debugging
- Verificar checkpoint WAL antes de copiar.
- Comparar checksums del `.db` original y restaurado.

## Acción recomendada (PRIORITARIA para versión comercial)
Implementar al menos el **backup manual + exportación CSV** antes de vender a
clientes medianos/grandes. Es un requisito habitual y un diferenciador de venta.
