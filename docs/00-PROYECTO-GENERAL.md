# 00 — PROYECTO GENERAL
## FlowTurn — Sistema Integral de Gestión de Turnos y Operaciones
### Desarrollado por RR Technologies

---

> ⚠️ **NOTA DE HONESTIDAD DOCUMENTAL (leer primero)**
>
> El template de documentación solicitado mencionaba módulos y tecnologías que
> **NO forman parte de este proyecto** (padres/tutores/niños, NestJS, PostgreSQL).
> Siguiendo la instrucción de *no inventar funcionalidades*, este conjunto de
> documentos describe el **sistema real construido en esta conversación**
> (Electron + Node.js + Express + SQLite) y marca explícitamente como
> `PENDIENTE` o `NO APLICA` cada punto del template que no corresponde.
>
> Las discrepancias template ↔ realidad están listadas en la sección 13 de este documento.

---

## 1. RESUMEN EJECUTIVO

### 1.1 Qué es el sistema

FlowTurn es una **aplicación de escritorio para Windows** que gestiona turnos y
operaciones en negocios de entretenimiento (paintball, karting, laser tag, parques
de atracciones). Se instala localmente y funciona sin depender de internet.

El sistema reemplaza el cuaderno / planilla Excel / radios con los que estos negocios
coordinan grupos de clientes entre la recepción y los operadores de cada atracción.

### 1.2 Objetivo del negocio (RR Technologies)

- Vender FlowTurn como **software de licencia perpetua** (pago único, sin suscripción).
- La instalación la realiza RR Technologies.
- El soporte y las actualizaciones se cobran por separado.
- La licencia existe **solo para evitar copias y redistribución no autorizada**, no para monetización recurrente.

### 1.3 Situación actual del cliente (perfil objetivo)

Negocios de entretenimiento que hoy coordinan turnos con:
- Cuaderno en recepción
- Planillas de Excel
- WhatsApp / radios entre recepción y operadores

Esto se rompe en días de alta demanda (sábados), generando grupos perdidos y caos operativo.

### 1.4 Problemas que busca resolver

| Problema | Origen |
|----------|--------|
| Descoordinación recepción ↔ operadores | No hay información en tiempo real |
| Grupos perdidos por esperas sin aviso | Falta de visibilidad de la cola |
| Dos grupos enviados a la misma atracción | Sin control de orden de cola |
| Sin datos del día (cuántos grupos se atendieron) | No hay registro digital |
| El dueño no ve lo que pasa si no está presente | Sin panel remoto |

### 1.5 Beneficios esperados

- Eliminación del cuaderno/Excel en tiempo real
- Operadores con visibilidad del siguiente grupo
- Pantalla pública (TV) con el estado de la cola
- Panel de administración con estadísticas
- Acceso desde celular/tablet en la red local

---

## 2. ESTADO ACTUAL DEL PROYECTO

### 2.1 Qué se definió y está IMPLEMENTADO

- ✅ Aplicación Electron empaquetada como instalador `.exe` (NSIS)
- ✅ Servidor Express embebido dentro de Electron
- ✅ Base de datos SQLite local (`better-sqlite3`)
- ✅ Comunicación en tiempo real con Socket.io
- ✅ Roles: superadmin / admin / operador / recepción
- ✅ Permisos granulares (`permiso_llamar_turno`, `permiso_cancelar_turno`, `permiso_gestionar_juegos`)
- ✅ Feature flags por admin (`feature_graficos`, `feature_juegos`, `feature_cancelar_turno`, `feature_llamar_turno`)
- ✅ Gestión de turnos con bipers, orden de cola FIFO, llamar/finalizar
- ✅ Gestión de atracciones/juegos con min/max miembros y duración
- ✅ Estadísticas con Chart.js
- ✅ Pantalla pública (TV)
- ✅ Sistema de licencias **perpetuo, offline, firmado con RSA**, vinculado al hardware
- ✅ Herramientas de licenciamiento (`generate-license.js`, `get-fingerprint.js`)
- ✅ Acceso multi-dispositivo en red local (mDNS `flowturn.local` + IP)
- ✅ Apertura automática de puerto en firewall
- ✅ Migración automática de datos entre versiones
- ✅ Rebranding completo a FlowTurn / RR Technologies

### 2.2 Qué falta definir / PENDIENTE

| Pendiente | Estado | Acción requerida |
|-----------|--------|------------------|
| Backups / exportación / importación | ❌ No implementado | Ver `80-SUBHILO-BACKUPS.md` |
| Logs de auditoría en el cliente | ⚠️ Solo existe en servidor de licencias | Ver `50-SUBHILO-LOGS.md` |
| Heartbeat / monitoreo del cliente | ⚠️ Existía en versión SaaS, deprecado | Ver `60-SUBHILO-SERVIDOR-ACTIVO.md` |
| Firma del `.exe` (code signing) | ❌ No comprado | Certificado EV (~$350/año) |
| Manual de usuario PDF | ❌ Pendiente | Para entrega al cliente |
| Módulo reservas / PDF / WhatsApp | ❌ Futuro | Vendibles como módulos adicionales |

### 2.3 Riesgos detectados

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| `.exe` sin firmar genera alerta de Windows | Media | Comprar certificado code signing |
| SQLite en servidor de licencias puede perder datos en Railway sin volumen persistente | Media | Para cliente único Railway ya no es necesario |
| Reverse engineering del ASAR | Media | Ofuscación + contrato legal |
| Cliente entrega el `.exe` a terceros | Alta | Hardware binding + cláusulas contractuales |
| Pérdida de la clave privada RSA | Crítica | Backup seguro fuera del PC |

---

## 3. ALCANCE DEL MVP (lo entregado)

El MVP está **completo y funcional**:
- Gestión de turnos end-to-end (recepción → operador → finalización)
- Multi-rol con permisos
- Estadísticas básicas
- Pantalla pública
- Licenciamiento perpetuo offline
- Instalador Windows

## 4. ALCANCE FUTURO

- Backups automáticos y exportación de datos
- Logs de auditoría del lado cliente
- Módulo de reportes PDF / Excel
- Módulo de reservas anticipadas
- Notificaciones WhatsApp
- Gestión multi-sucursal
- Code signing del instalador

---

## 5. TECNOLOGÍAS SELECCIONADAS (REALES)

> ⚠️ El template solicitaba NestJS + PostgreSQL. **Esto NO se usa.** El stack real es:

| Capa | Tecnología real | Notas |
|------|-----------------|-------|
| **Shell de escritorio** | Electron 31 | Empaqueta Node + Chromium |
| **Backend** | Node.js + Express 4 | Servidor embebido en :3000 |
| **Frontend** | HTML + Bootstrap 5 + JS vanilla (CDN) | Sin framework SPA |
| **Base de datos** | SQLite vía `better-sqlite3` | Local en `AppData/Roaming/flowturn` |
| **Tiempo real** | Socket.io 4 | Eventos entre paneles |
| **Gráficos** | Chart.js 4 | Estadísticas admin |
| **Auth** | express-session + bcryptjs | Sesiones server-side |
| **Licencias** | jsonwebtoken (RSA RS256) + crypto + node:crypto | Certificado offline firmado |
| **Hardware ID** | WMIC (csproduct UUID + diskdrive serial) | Fingerprint SHA-256 |
| **Red local** | bonjour-service (mDNS) | `flowturn.local` |
| **Build** | electron-builder + electron-packager | NSIS installer |
| **Ofuscación** | javascript-obfuscator | Protección de código |
| **Infraestructura (opcional)** | Railway (servidor de licencias) | Solo para modelo multi-cliente; deprecado para cliente único |
| **Repositorio** | GitHub privado (`NoeliaRomero/sistema-turnos`) | — |

---

## 6. ARQUITECTURA GENERAL

### 6.1 Para negocio (explicación simple)

FlowTurn vive **dentro de la PC del cliente**. Es como tener un servidor privado
en la computadora del local. Las demás pantallas (tablets, celulares, otra PC)
se conectan a esa PC por WiFi. No necesita internet para funcionar.

La activación inicial usa un archivo de licencia que RR Technologies genera y que
solo funciona en esa computadora específica.

### 6.2 Para desarrolladores

```
┌──────────────────────── PC DEL CLIENTE ────────────────────────┐
│  Electron (main.js)                                            │
│   ├─ Verifica license.lic (RSA + hardware fingerprint)         │
│   ├─ Migra datos de versiones anteriores                       │
│   ├─ Abre puerto 3000 en firewall                              │
│   ├─ Levanta Express embebido (server/server.js) en 0.0.0.0   │
│   ├─ Publica mDNS flowturn.local                               │
│   └─ Abre BrowserWindow → http://127.0.0.1:3000               │
│                                                                │
│  Express + Socket.io                                           │
│   ├─ /api/auth      (login, sesión)                            │
│   ├─ /api/atracciones                                          │
│   ├─ /api/turnos                                               │
│   ├─ /api/usuarios                                             │
│   ├─ /api/stats                                                │
│   └─ /api/superadmin (feature flags)                           │
│                                                                │
│  SQLite (turnos.db en AppData/Roaming/flowturn)               │
└────────────────────────────────────────────────────────────────┘
        ▲ WiFi red local (mDNS / IP)
        │
   Tablets / celulares / otra PC  → http://flowturn.local:3000
```

---

## 7. MÓDULOS IDENTIFICADOS (REALES)

| # | Módulo | Archivos principales | Estado |
|---|--------|---------------------|--------|
| M1 | Autenticación y sesión | `routes/auth.js`, `middleware/auth.js`, `login.html` | ✅ |
| M2 | Turnos / cola / bipers | `routes/turnos.js`, `recepcion.js`, `operador.js`, `cola.js` | ✅ |
| M3 | Atracciones / juegos | `routes/atracciones.js`, `juegos.js`, `juegos.html` | ✅ |
| M4 | Usuarios / roles / permisos | `routes/usuarios.js`, `admin.js`, `admin.html` | ✅ |
| M5 | Estadísticas | `routes/stats.js`, `admin.js` (Chart.js) | ✅ |
| M6 | Pantalla pública (TV) | `pantalla.html`, `pantalla.js` | ✅ |
| M7 | Superadmin / feature flags | `routes/superadmin.js`, `superadmin.html`, `superadmin.js` | ✅ |
| M8 | Licenciamiento | `electron/license.js`, `tools/*.js` | ✅ |
| M9 | Shell Electron / red / firewall | `electron/main.js`, `preload.js`, `machineId.js` | ✅ |
| M10 | Servidor de licencias (nube) | `license-server/**` | ⚠️ Opcional / deprecado para cliente único |
| M11 | Backups | — | ❌ Pendiente |
| M12 | Logs / auditoría | `license-server` (activation_events) | ⚠️ Parcial |

---

## 8. DEPENDENCIAS ENTRE MÓDULOS

```
M9 (Electron) ─── arranca ──→ M2,M3,M4,M5,M6,M7 (Express)
M9 (Electron) ─── valida ───→ M8 (Licencia)
M2 (Turnos)   ─── usa ──────→ M3 (Atracciones) [atraccion_id]
M2 (Turnos)   ─── usa ──────→ M4 (Usuarios)    [llamado_por, finalizado_por]
M4 (Usuarios) ─── controla ─→ permisos de M2, M3
M7 (Superadmin)── controla ─→ feature flags de M4 (admin)
M5 (Stats)    ─── lee ──────→ M2 (Turnos)
M6 (Pantalla) ─── lee ──────→ M2 (Turnos) vía Socket.io
M8 (Licencia) ─── opcional ─→ M10 (Servidor licencias)
```

---

## 9. REGLAS FUNCIONALES DETECTADAS

| ID | Regla | Origen |
|----|-------|--------|
| RF-01 | Solo el primer grupo de la cola (FIFO) puede ser llamado | Backend valida `created_at ASC` |
| RF-02 | Si la atracción ya tiene un grupo jugando, pedir confirmación antes de llamar otro | Modal de confirmación |
| RF-03 | La cantidad de miembros del grupo debe estar entre `min_miembros` y `max_miembros` de la atracción | Configurable por juego |
| RF-04 | Solo cuando un **operador** finaliza, se notifica a recepción (toast, no modal) | `if rol === 'operador'` |
| RF-05 | El admin no puede entrar a paneles de recepción/operador con su mismo usuario | Redirige a `/admin.html` |
| RF-06 | El superadmin no aparece en la lista de usuarios del admin | `WHERE rol != 'superadmin'` |
| RF-07 | Recepción puede llamar/finalizar solo si tiene `permiso_llamar_turno` | Otorgado por admin |
| RF-08 | El admin solo puede otorgar permisos que el superadmin le habilitó (feature flags) | Modelo de planes |
| RF-09 | No existe el rol "caja" (eliminado); solo recepción | Decisión de la conversación |

## 10. REGLAS TÉCNICAS DETECTADAS

| ID | Regla | Origen |
|----|-------|--------|
| RT-01 | La BD vive en `AppData/Roaming/flowturn`, NO en Program Files | `process.env.DB_PATH` |
| RT-02 | El servidor escucha en `0.0.0.0:3000` para permitir red local | `main.js` |
| RT-03 | La licencia se verifica 100% offline (firma RSA + hardware) | `electron/license.js` |
| RT-04 | El certificado de licencia NO tiene vencimiento (perpetuo) | `generate-license.js` |
| RT-05 | La clave privada RSA nunca se distribuye; solo la pública va en el `.exe` | Seguridad |
| RT-06 | Módulos nativos (`better-sqlite3`, `keytar`, `bonjour-service`) en `asarUnpack` | electron-builder |
| RT-07 | DevTools bloqueados en producción | `main.js` |
| RT-08 | El JS del frontend se ofusca antes de empaquetar | `scripts/obfuscate.js` |

---

## 11. ESTIMACIÓN GENERAL DEL PROYECTO

> Estimaciones basadas en el trabajo realizado en esta conversación.

### Fase 1 — MVP (COMPLETADA)
Sistema base de turnos + roles + estadísticas + pantalla + instalador.
**Estado: ✅ Hecho.**

### Fase 2 — Licenciamiento perpetuo + distribución (COMPLETADA)
Licencia offline RSA + hardware binding + herramientas + rebranding + red local.
**Estado: ✅ Hecho.**

### Fase 3 — Robustez comercial (PENDIENTE)
| Tarea | Estimación |
|-------|-----------|
| Backups / exportación / importación | ~1–2 días |
| Logs de auditoría en cliente | ~1 día |
| Manual de usuario PDF | ~0.5 día |
| Code signing del instalador | Trámite + ~0.5 día |
| Módulo reportes PDF | ~1–2 días |

---

## 12. DOCUMENTOS RELACIONADOS

| Documento | Contenido |
|-----------|-----------|
| `01-INSTRUCCIONES-PROYECTO-PADRE.md` | Perfil del asistente técnico (Co-Equiper) |
| `10-SUBHILO-BUGS.md` | Bugs, debugging, refactors |
| `20-SUBHILO-ROLES-Y-ACTIVIDADES.md` | Roles, permisos, atracciones |
| `30-SUBHILO-PADRES-RESPONSABLES.md` | **NO APLICA** (explicado dentro) |
| `40-SUBHILO-GESTION-DE-ACTIVIDADES.md` | Gestión operativa de turnos |
| `50-SUBHILO-LOGS.md` | Logs / auditoría (parcial) |
| `60-SUBHILO-SERVIDOR-ACTIVO.md` | Heartbeat / monitoreo (deprecado) |
| `70-SUBHILO-BEEPERS.md` | Bipers (sí existen) |
| `80-SUBHILO-BACKUPS.md` | Backups (pendiente) |
| `90-ESTRUCTURA-DE-CARPETAS.md` | Estructura del repo |
| `91-GUIA-DE-DESARROLLO.md` | Cómo desarrollar |
| `92-GUIA-DE-DEBUGGING.md` | Cómo debuggear |
| `93-GUIA-DE-COMPILACION.md` | Build y distribución |
| `94-GUIA-PARA-NUEVOS-DESARROLLADORES.md` | Onboarding |

---

## 13. DISCREPANCIAS TEMPLATE ↔ REALIDAD (a validar)

| Lo que pedía el template | Realidad de FlowTurn | Resolución |
|--------------------------|----------------------|------------|
| NestJS | Express | Documentado el real (Express) |
| PostgreSQL | SQLite | Documentado el real (SQLite) |
| Módulo "padres/tutores/niños" | No existe | `30-SUBHILO` marcado NO APLICA |
| "Roles y actividades" (con niños) | Roles + atracciones | Adaptado a la realidad |
| "Beepers" como integración externa | Bipers = número de turno (campo `biper_numero`) | Adaptado |
| Heartbeat/servidor activo | Existió en versión SaaS, deprecado | Marcado como histórico/opcional |
| Backups | No implementado | Marcado pendiente |

**Acción recomendada:** confirmar con RR Technologies si se desea desarrollar
los módulos pendientes (backups, logs cliente) o si el alcance actual es el final.
