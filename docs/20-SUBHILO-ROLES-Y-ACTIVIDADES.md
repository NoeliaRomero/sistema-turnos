# 20 — SUBHILO: ROLES, PERMISOS Y ATRACCIONES

> ⚠️ **Adaptación del template:** el template pedía "actividades / segmentación / niños".
> En FlowTurn no existen "niños/actividades". Existen **roles, permisos y atracciones (juegos)**.
> Este subhilo cubre esa realidad.

---

## Objetivo
Gestionar el sistema de roles, permisos granulares, feature flags y la configuración
de atracciones/juegos.

## Alcance
- Roles: `superadmin`, `admin`, `operador`, `recepcion`.
- Permisos: `permiso_llamar_turno`, `permiso_cancelar_turno`, `permiso_gestionar_juegos`.
- Feature flags (controlados por superadmin sobre cada admin):
  `feature_graficos`, `feature_juegos`, `feature_cancelar_turno`, `feature_llamar_turno`.
- Atracciones/juegos: CRUD, `min_miembros`, `max_miembros`, `duracion_minutos`, `activa`.

## Responsabilidades
- Mantener la jerarquía de roles coherente.
- Garantizar que el admin solo otorgue permisos habilitados por el superadmin.
- Validar rangos de miembros por atracción.

## Carpetas / archivos afectados
- `server/routes/usuarios.js`
- `server/routes/atracciones.js`
- `server/routes/superadmin.js`
- `server/middleware/auth.js`
- `public/admin.html`, `public/js/admin.js`
- `public/juegos.html`, `public/js/juegos.js`
- `public/superadmin.html`, `public/js/superadmin.js`

## Riesgos
- Cambiar la jerarquía de roles puede romper redirecciones de login.
- Tocar `auth.js` impacta a TODOS los módulos (es middleware central).

## Dependencias
- `40-GESTION-DE-ACTIVIDADES` consume las atracciones definidas aquí.
- `10-BUGS` puede pedir cambios; coordinar.

## Qué PUEDE modificar
- Definición de roles, permisos y feature flags.
- Esquema de la tabla `atracciones` y `usuarios` (columnas de permisos/features).
- UI de admin/superadmin/juegos.

## Qué NO PUEDE modificar
- Lógica de turnos (`routes/turnos.js`) → es de `40`.
- Licenciamiento.

## Coordinación con otros subhilos
- Cualquier cambio en `middleware/auth.js` debe avisarse a `40` y `10`.
- Cambios de esquema en `usuarios`/`atracciones` requieren migración (ver reglas en `90`).

## Criterios de aceptación
- Cada rol ve solo lo que le corresponde.
- El admin no accede a recepción/operador (RF-05).
- El superadmin no aparece en la lista de usuarios (RF-06).
- Los rangos min/max de miembros se respetan al crear turnos.

## Estrategia de testing
- Login con cada rol y verificar redirección y vistas.
- Crear/editar atracción y verificar límites.
- Toggle de feature flags desde superadmin y verificar efecto en admin.

## Estrategia de debugging
- Inspeccionar `req.session.usuario` en los endpoints.
- Verificar columnas de permisos/features en SQLite.

## Reglas funcionales propias
- RF-03 (rango miembros), RF-05 (admin no entra a otros paneles),
  RF-06 (superadmin oculto), RF-07 (permiso_llamar_turno), RF-08 (feature flags),
  RF-09 (no existe "caja").
