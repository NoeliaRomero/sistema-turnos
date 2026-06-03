# 30 — SUBHILO: PADRES / TUTORES / RESPONSABLES

> 🚫 **ESTE MÓDULO NO APLICA A FlowTurn.**

---

## Aclaración obligatoria

El template de documentación solicitaba un subhilo de "padres, tutores, responsables
y vínculos con niños". **Esta funcionalidad nunca fue discutida ni desarrollada en
este proyecto.** FlowTurn es un sistema de gestión de turnos para negocios de
entretenimiento (paintball, karting, etc.); no maneja niños, tutores ni vínculos
familiares.

Siguiendo la instrucción explícita de **no inventar funcionalidades**, este documento
NO describe un módulo inexistente.

## ¿Por qué aparecía en el template?

El template parece provenir de **otro proyecto** (posiblemente uno de gestión de
actividades infantiles). Se incluyó por error al reutilizar la plantilla.

## ¿Qué concepto de FlowTurn es lo más cercano?

Lo más parecido a un "responsable de un grupo" en FlowTurn es el campo del turno
que identifica al grupo de clientes:

| Campo real en FlowTurn | Significado |
|------------------------|-------------|
| `nombre_cliente` (en tabla `turnos`) | Nombre del grupo/familia que espera turno |
| `cantidad_miembros` | Cuántas personas integran el grupo |
| `biper_numero` | Número de biper/turno asignado |

Esto se gestiona en el **subhilo 40 (Gestión de Turnos)** y **70 (Bipers)**.

## Acción recomendada

- ❌ No desarrollar este módulo salvo que RR Technologies lo pida explícitamente
  como una funcionalidad nueva (sería Fase 4, fuera del alcance actual).
- ✅ Si se necesita registrar datos del responsable del grupo (ej: DNI, teléfono),
  eso sería una **extensión del módulo de turnos**, no un módulo de "padres/niños".

## Estado
`NO APLICA` — sin código, sin carpetas, sin responsabilidades asignadas.
