# 70 — SUBHILO: BIPERS (NÚMEROS DE TURNO)

> ⚠️ **Aclaración:** el template hablaba de "beepers" como una integración de hardware
> externa. En FlowTurn, un **biper** es el **número/identificador de turno** que se
> asigna a cada grupo (campo `biper_numero` en la tabla `turnos`). NO es un dispositivo
> físico integrado por software (aunque el negocio puede entregar un biper físico al
> cliente con ese número). Este subhilo cubre la realidad: gestión del número de biper.

---

## Objetivo
Gestionar la asignación, visualización y cancelación de bipers (números de turno)
asociados a cada grupo en la cola.

## Alcance
- Campo `biper_numero` en la tabla `turnos`.
- Asignación al registrar un turno (recepción).
- Visualización en paneles y pantalla pública.
- Cancelación de bipers (con permiso `permiso_cancelar_turno`).

## Responsabilidades
- Asegurar que cada turno tenga un biper identificable.
- Mostrar el biper en operador y en la pantalla pública.
- Permitir cancelar un biper de un cliente que no llegó.

## Carpetas / archivos afectados
- `server/routes/turnos.js` (campo `biper_numero`)
- `public/js/recepcion.js` (asignación)
- `public/js/operador.js`, `public/js/pantalla.js` (visualización)

## Riesgos
- Bipers duplicados si no se controla la asignación.
- Confusión entre el número de biper físico (si el negocio usa) y el número del sistema.

## Dependencias
- Comparte la tabla `turnos` con `40` (gestión de turnos). **Alta coordinación.**
- Cancelación depende del permiso definido en `20`.

## Qué PUEDE modificar
- Lógica de asignación y visualización del `biper_numero`.
- UI relacionada a mostrar/ingresar el biper.

## Qué NO PUEDE modificar
- La lógica de orden de cola y llamado (es de `40`).
- Esquema de roles/permisos (es de `20`).

## Coordinación con otros subhilos
- **Crítico:** `70` y `40` editan `routes/turnos.js`. Coordinar siempre para evitar
  conflictos de merge. Sugerencia: que `40` sea el dueño del archivo y `70` proponga
  cambios vía PR revisado por `40`.

## Criterios de aceptación
- Cada grupo registrado tiene un `biper_numero` visible.
- El biper aparece en operador y pantalla pública.
- Se puede cancelar un biper con el permiso correspondiente.

## Estrategia de testing
- Registrar turno y verificar biper asignado.
- Verificar visualización en todos los paneles.
- Cancelar biper con y sin permiso.

## Estrategia de debugging
- Inspeccionar `biper_numero` y `estado` en la tabla `turnos`.

## Nota de validación (PENDIENTE)
Confirmar con RR Technologies si en el futuro se quiere integrar **bipers físicos
reales** (dispositivos que vibran/suenan). Hoy NO existe esa integración; el "biper"
es solo el número del sistema.
