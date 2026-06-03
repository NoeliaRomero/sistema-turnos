# 60 — SUBHILO: SERVIDOR ACTIVO (HEARTBEAT / MONITOREO / ALERTAS)

> ⚠️ **Estado: DEPRECADO para el modelo actual.** El heartbeat/monitoreo existió en la
> versión **SaaS** del sistema de licencias y fue **removido** al migrar al modelo de
> **licencia perpetua offline**. Este documento explica qué había, por qué se quitó y
> qué monitoreo aplica hoy.

---

## Contexto histórico

En la arquitectura SaaS inicial:
- El cliente revalidaba la licencia (JWT) **cada 30 días** contra Railway.
- Había una verificación periódica cada 12 horas (`startPeriodicLicenseCheck`).
- El servidor podía **revocar** licencias en tiempo real (evento `license:revoked`).
- Período de gracia offline (primero 7 días, luego 90).

## Por qué se deprecó

El modelo comercial cambió a **licencia perpetua, pago único, sin dependencia de
internet**. Un sistema que requiere heartbeat periódico es, de hecho, una suscripción
encubierta. Por decisión explícita:
- El certificado de licencia ahora es **perpetuo** (sin `expiresIn`).
- La verificación es **100% local** (firma RSA + hardware fingerprint).
- **No hay heartbeat ni revalidación periódica.**

## Qué monitoreo APLICA hoy

| Componente | ¿Necesita monitoreo? | Cómo |
|-----------|----------------------|------|
| Cliente FlowTurn (offline) | ❌ No | Funciona solo, sin servidor |
| Servidor de licencias Railway | ⚠️ Solo si se usa modelo multi-cliente | UptimeRobot al endpoint `/health` |

## Objetivo (solo si se reactiva el modelo SaaS/multi-cliente)
Monitorear disponibilidad del servidor de licencias y alertar caídas.

## Alcance (condicional)
- Endpoint `/health` ya existe en `license-server/server.js`.
- Monitoreo externo gratuito (UptimeRobot / BetterUptime).

## Carpetas / archivos afectados
- `license-server/server.js` (endpoint `/health`)
- Histórico (removido del cliente): lógica de `startPeriodicLicenseCheck` en `electron/main.js`

## Riesgos
- Reintroducir heartbeat en el cliente **rompería** la promesa comercial de
  funcionamiento offline perpetuo. No hacerlo sin decisión de negocio explícita.

## Dependencias
- Solo `08-licenciamiento` / `M10` (servidor de licencias).

## Qué PUEDE modificar
- Configuración de monitoreo externo del servidor de licencias.
- Endpoint `/health`.

## Qué NO PUEDE modificar
- ❌ No reintroducir verificación periódica online en el cliente sin aprobación.

## Criterios de aceptación
- El servidor de licencias (si se usa) responde `/health` con `{ok:true}`.
- El cliente sigue funcionando sin conexión.

## Estrategia de testing / debugging
- `GET https://<servidor>/health`.
- Verificar que el cliente arranca con internet desconectado.

## Acción recomendada
Mantener este módulo **inactivo** salvo que RR Technologies decida ofrecer una
variante SaaS en el futuro (Fase 4).
