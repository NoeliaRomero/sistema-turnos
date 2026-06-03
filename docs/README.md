# Documentación del Proyecto — FlowTurn (RR Technologies)

Documentación colaborativa para trabajo multi-subhilo sobre FlowTurn.

> ⚠️ El template original mencionaba módulos/tecnologías ajenas (padres/niños,
> NestJS, PostgreSQL). Esta documentación describe el **sistema real**
> (Electron + Node + Express + SQLite) y marca lo que **no aplica** o está **pendiente**.

## Índice

| # | Documento | Contenido |
|---|-----------|-----------|
| 00 | [Proyecto General](00-PROYECTO-GENERAL.md) | Visión, módulos, arquitectura, estado |
| 01 | [Instrucciones Proyecto Padre](01-INSTRUCCIONES-PROYECTO-PADRE.md) | Co-Equiper / asistente técnico |
| 10 | [Subhilo Bugs](10-SUBHILO-BUGS.md) | Bugs, debugging, refactors |
| 20 | [Subhilo Roles y Atracciones](20-SUBHILO-ROLES-Y-ACTIVIDADES.md) | Roles, permisos, atracciones |
| 30 | [Subhilo Padres/Responsables](30-SUBHILO-PADRES-RESPONSABLES.md) | ❌ NO APLICA |
| 40 | [Subhilo Gestión de Turnos](40-SUBHILO-GESTION-DE-ACTIVIDADES.md) | Cola, llamado, finalización |
| 50 | [Subhilo Logs](50-SUBHILO-LOGS.md) | Auditoría (parcial) |
| 60 | [Subhilo Servidor Activo](60-SUBHILO-SERVIDOR-ACTIVO.md) | Heartbeat (deprecado) |
| 70 | [Subhilo Bipers](70-SUBHILO-BEEPERS.md) | Números de turno |
| 80 | [Subhilo Backups](80-SUBHILO-BACKUPS.md) | ❌ Pendiente |
| 90 | [Estructura de Carpetas](90-ESTRUCTURA-DE-CARPETAS.md) | Estructura + matrices + Git |
| 91 | [Guía de Desarrollo](91-GUIA-DE-DESARROLLO.md) | Cómo desarrollar |
| 92 | [Guía de Debugging](92-GUIA-DE-DEBUGGING.md) | Cómo debuggear |
| 93 | [Guía de Compilación](93-GUIA-DE-COMPILACION.md) | Build y distribución |
| 94 | [Guía Nuevos Desarrolladores](94-GUIA-PARA-NUEVOS-DESARROLLADORES.md) | Onboarding |

## Estado de módulos

| Módulo | Estado |
|--------|--------|
| Turnos, roles, atracciones, estadísticas, pantalla | ✅ Implementado |
| Licenciamiento perpetuo offline | ✅ Implementado |
| Bipers (número de turno) | ✅ Implementado |
| Logs de auditoría (cliente) | ⚠️ Parcial / pendiente |
| Heartbeat / servidor activo | ⚠️ Deprecado (modelo offline) |
| Backups / exportación | ❌ Pendiente |
| Módulo padres/niños | ❌ No aplica (template ajeno) |
