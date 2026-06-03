# 40 — SUBHILO: GESTIÓN OPERATIVA DE TURNOS

> ⚠️ **Adaptación:** el template decía "gestión de actividades". En FlowTurn el núcleo
> operativo es la **gestión de turnos** (cola, llamado, finalización). Este subhilo cubre eso.

---

## Objetivo
Mantener el funcionamiento operativo del flujo de turnos: registro, cola, llamado,
finalización y cancelación, con su lógica de orden y notificaciones en tiempo real.

## Alcance
- Registro de turnos (recepción).
- Cola FIFO por atracción.
- Llamado del siguiente grupo (operador / recepción con permiso).
- Finalización de turnos.
- Cancelación de bipers.
- Notificaciones en tiempo real (Socket.io).
- Pantalla pública (TV) de la cola.

## Responsabilidades
- Garantizar el orden FIFO de la cola (RF-01).
- Confirmar antes de llamar si la atracción ya está ocupada (RF-02).
- Notificar a recepción solo cuando un operador finaliza (RF-04).
- Propagar cambios en tiempo real a todos los dispositivos.

## Carpetas / archivos afectados
- `server/routes/turnos.js`
- `public/recepcion.html`, `public/js/recepcion.js`
- `public/operador.html`, `public/js/operador.js`
- `public/cola.html`, `public/js/cola.js`
- `public/pantalla.html`, `public/js/pantalla.js`

## Riesgos
- Cambiar la lógica de orden de cola afecta directamente la operación del negocio.
- Tocar los eventos de Socket.io puede desincronizar paneles.

## Dependencias
- Consume atracciones de `20` (`atraccion_id`, `min/max_miembros`).
- Consume usuarios/permisos de `20` (`llamado_por`, `finalizado_por`, `permiso_llamar_turno`).
- `50-LOGS` podría registrar eventos de turnos (pendiente).
- `70-BIPERS` comparte el campo `biper_numero`.

## Qué PUEDE modificar
- `routes/turnos.js` y los paneles de recepción/operador/cola/pantalla.
- Eventos Socket.io relacionados a turnos.

## Qué NO PUEDE modificar
- Esquema de roles/permisos (es de `20`).
- Definición de atracciones (es de `20`).
- Licenciamiento / Electron shell.

## Coordinación con otros subhilos
- Cambios en eventos Socket.io deben avisarse porque la pantalla pública depende de ellos.
- Si se agrega una columna a `turnos`, coordinar migración con `20` y `80`.

## Criterios de aceptación
- Solo el primer grupo de la cola puede llamarse (RF-01).
- Confirmación al llamar con atracción ocupada (RF-02).
- Notificación a recepción solo en finalización por operador (RF-04).
- La pantalla pública refleja los cambios en tiempo real.

## Estrategia de testing
- Simular cola con varios grupos y verificar orden.
- Probar llamar/finalizar desde operador y desde recepción (con y sin permiso).
- Verificar sincronización PC ↔ celular.

## Estrategia de debugging
- Loguear eventos Socket.io emitidos/recibidos.
- Inspeccionar estado de `turnos` (estado: esperando/jugando/finalizado) en SQLite.

## Reglas funcionales propias
RF-01, RF-02, RF-04, RF-07.
