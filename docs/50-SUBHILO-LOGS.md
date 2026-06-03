# 50 — SUBHILO: LOGS, AUDITORÍA Y TRAZABILIDAD

> ⚠️ **Estado: PARCIAL.** Hoy solo existe trazabilidad en el **servidor de licencias**
> (tabla `activation_events`). En el cliente FlowTurn **no hay un módulo de logs de
> auditoría de negocio implementado**. Este subhilo cubre lo existente y define lo pendiente.

---

## Objetivo
Registrar y consultar eventos relevantes para auditoría y trazabilidad.

## Alcance ACTUAL (implementado)
- **Servidor de licencias** (`license-server/`): tabla `activation_events` registra
  `new`, `reinstall`, `reactivation`, `rejected`, `deactivated` con hardware, IP, fecha.
- Visible en el panel superadmin → "Licencias y Activaciones" → Historial.

## Alcance PENDIENTE (no implementado)
- Logs de auditoría del lado **cliente** (quién llamó/finalizó/canceló turnos, login/logout).
- Exportación de logs.
- Retención y rotación de logs.

> ℹ️ Trazabilidad parcial ya existente en negocio: la tabla `turnos` guarda
> `llamado_por`, `finalizado_por`, `created_at`, `called_at`, `finished_at`.
> Esto es un punto de partida natural para un módulo de auditoría.

## Responsabilidades
- Mantener el historial de activaciones del servidor de licencias.
- (Futuro) Diseñar e implementar logs de auditoría de negocio en el cliente.

## Carpetas / archivos afectados
- Actual: `license-server/routes/licenses.js`, `license-server/db/database.js`
- Futuro: nueva tabla `audit_log` en `server/db/database.js` + endpoints en `server/routes/`

## Riesgos
- Logs excesivos pueden inflar la base SQLite local.
- Registrar datos sensibles requiere cuidado (no guardar contraseñas).

## Dependencias
- Para auditar turnos, depende de `40`.
- Para auditar usuarios/roles, depende de `20`.
- `80-BACKUPS` debería incluir los logs en los backups.

## Qué PUEDE modificar
- Tabla `activation_events` y su lógica en el servidor de licencias.
- (Futuro) nueva tabla de auditoría en el cliente, sin tocar lógica de negocio existente.

## Qué NO PUEDE modificar
- La lógica de turnos/roles (solo puede **leer** para registrar).

## Coordinación con otros subhilos
- Acordar con `40` y `20` qué eventos se registran y con qué campos.
- Acordar con `80` la inclusión de logs en backups.

## Criterios de aceptación
- (Actual) El historial de activaciones se muestra correctamente en el panel.
- (Futuro) Cada acción crítica de negocio queda registrada con usuario, acción y timestamp.

## Estrategia de testing
- Generar activaciones de prueba y verificar el historial.
- (Futuro) Ejecutar acciones de turnos y verificar que se registren.

## Estrategia de debugging
- Inspeccionar `activation_events` en la BD del servidor de licencias.
- (Futuro) inspeccionar `audit_log` en la BD del cliente.

## Acción recomendada
Confirmar con RR Technologies si se requiere auditoría de negocio en el cliente
para la versión comercial (recomendado para clientes grandes).
