# Sistema Universal de Gestión de Turnos
## Documentación de Implementación

---

## Índice

1. [Descripción del sistema](#1-descripción-del-sistema)
2. [Requisitos técnicos](#2-requisitos-técnicos)
3. [Instalación paso a paso](#3-instalación-paso-a-paso)
4. [Estructura de archivos](#4-estructura-de-archivos)
5. [Primero arranque y credenciales](#5-primer-arranque-y-credenciales)
6. [Roles y permisos](#6-roles-y-permisos)
7. [Guía de cada panel](#7-guía-de-cada-panel)
8. [Cómo acceder desde otros dispositivos](#8-cómo-acceder-desde-otros-dispositivos)
9. [Configuración inicial para el cliente](#9-configuración-inicial-para-el-cliente)
10. [Control de módulos por plan (Superadmin)](#10-control-de-módulos-por-plan-superadmin)
11. [Arrancar el servidor automáticamente](#11-arrancar-el-servidor-automáticamente)
12. [Solución de problemas frecuentes](#12-solución-de-problemas-frecuentes)
13. [Referencia de URLs](#13-referencia-de-urls)

---

## 1. Descripción del sistema

Sistema web de gestión de turnos con bipers para parques de atracciones, paintball, karting, escape rooms y similares. Permite:

- **Recepción** registra grupos con nombre, biper y cantidad de personas
- **Operador** llama al siguiente grupo y finaliza turnos desde su panel
- **TV pública** muestra en tiempo real quién está jugando y quién espera
- **Admin** gestiona usuarios, juegos y ve estadísticas
- **Superadmin** (desarrollador) controla qué módulos tiene habilitado cada cliente según su plan de pago

### Tecnologías utilizadas
- **Backend:** Node.js + Express + Socket.io
- **Base de datos:** SQLite (archivo local, sin servidor externo)
- **Frontend:** HTML + Bootstrap 5 + Chart.js
- **Tiempo real:** WebSockets vía Socket.io

---

## 2. Requisitos técnicos

### En la PC del cliente (servidor)
| Requisito | Versión mínima | Cómo verificar |
|---|---|---|
| Node.js | v18 o superior (recomendado v24) | `node --version` en CMD |
| Windows | 10 o superior | — |
| RAM | 2 GB mínimo | — |
| Disco | 500 MB libres | — |
| Red local | WiFi o cable (para acceso desde celu/tablets) | — |

### Descargar Node.js
👉 https://nodejs.org → descargar la versión **LTS**

### En otros dispositivos (celulares, tablets, segunda PC)
- Solo necesitan un **navegador web** (Chrome, Firefox, Safari)
- Deben estar en la **misma red WiFi** que la PC servidor

---

## 3. Instalación paso a paso

### Paso 1 — Copiar la carpeta
Copiá la carpeta **"Sistema Universal"** al equipo del cliente. Puede ir en:
- `C:\Sistema Universal\` ← recomendado
- O en el Escritorio

### Paso 2 — Instalar dependencias
1. Abrí el CMD o PowerShell **dentro de la carpeta**
   - Opción rápida: en el Explorador de Windows, escribí `cmd` en la barra de dirección y Enter
2. Ejecutá:
```
npm install
```
3. Esperá que termine (puede tardar 1-2 minutos la primera vez)

### Paso 3 — Arrancar el servidor
```
npm start
```
Deberías ver:
```
✅ Sistema de Turnos iniciado
🌐 http://localhost:3000
```

### Paso 4 — Abrir en el navegador
Abrí Chrome o Firefox y entrá a:
```
http://localhost:3000
```

¡Listo! El sistema está funcionando.

---

## 4. Estructura de archivos

```
Sistema Universal\
│
├── server.js              ← Punto de entrada del servidor
├── package.json           ← Dependencias del proyecto
│
├── db\
│   └── database.js        ← Configuración de base de datos y datos iniciales
│   └── turnos.db          ← Base de datos SQLite (se crea al primer arranque)
│
├── middleware\
│   └── auth.js            ← Verificación de sesión y permisos
│
├── routes\
│   ├── auth.js            ← Login, logout, sesión
│   ├── atracciones.js     ← Gestión de juegos/atracciones
│   ├── turnos.js          ← Cola, llamar, finalizar, cancelar turnos
│   ├── usuarios.js        ← Gestión de usuarios
│   ├── stats.js           ← Estadísticas y gráficos
│   └── superadmin.js      ← Control de módulos por cliente
│
└── public\                ← Archivos del navegador (HTML, JS, CSS)
    ├── login.html
    ├── index.html
    ├── admin.html
    ├── superadmin.html
    ├── operador.html
    ├── recepcion.html
    ├── juegos.html
    ├── cola.html          ← Pantalla TV (sin login)
    └── js\
        ├── admin.js
        ├── superadmin.js
        ├── operador.js
        ├── recepcion.js
        ├── juegos.js
        └── cola.js
```

---

## 5. Primer arranque y credenciales

Al iniciar por primera vez, el sistema crea automáticamente estos usuarios:

| Rol | Usuario | Contraseña |
|---|---|---|
| **Superadmin** (desarrollador) | `superadmin` | `super123` |
| **Administrador** (cliente) | `admin` | `admin123` |

> ⚠️ **IMPORTANTE:** Cambiar estas contraseñas antes de entregar el sistema al cliente.
> El admin puede cambiarse desde el panel de usuarios.
> El superadmin debe cambiarse en `db/database.js` (línea del seed) o directamente en la base de datos.

### Cambiar contraseña del superadmin
1. Iniciar sesión como `admin`
2. Ir a **Usuarios** → buscar "Administrador" → **Editar**
3. Escribir nueva contraseña → Guardar

---

## 6. Roles y permisos

### Jerarquía de roles

```
superadmin  →  Desarrollador. Controla qué módulos tiene cada cliente.
    │
   admin     →  Dueño/gerente del negocio. Gestiona su sistema.
    │
   operador  →  Atiende el juego. Llama y finaliza turnos.
    │
  recepcion  →  Registra grupos en la cola. Puede tener permisos extra.
```

### Tabla de capacidades por rol

| Acción | Superadmin | Admin | Operador | Recepción |
|---|:---:|:---:|:---:|:---:|
| Ver estadísticas y gráficos | ✅ | ⚙️ | ❌ | ❌ |
| Gestionar juegos/atracciones | ✅ | ⚙️ | ❌ | ❌ |
| Gestionar usuarios | ✅ | ✅ | ❌ | ❌ |
| Registrar grupos en cola | ✅ | ✅ | ❌ | ✅ |
| Llamar siguiente grupo | ✅ | ✅ | ✅ | ⚙️ |
| Finalizar turno | ✅ | ✅ | ✅ | ⚙️ |
| Cancelar biper | ✅ | ✅ | ⚙️ | ⚙️ |
| Controlar módulos de clientes | ✅ | ❌ | ❌ | ❌ |

**⚙️** = Requiere que el admin/superadmin habilite ese permiso

### Permisos extra que el admin puede dar

Cuando el admin crea o edita un usuario con rol **Operador** o **Recepción**, puede asignarle:

| Permiso | A quién aplica | Qué permite |
|---|---|---|
| Llamar y finalizar desde recepción | Recepción | Llamar al siguiente grupo y finalizar turnos en curso |
| Cancelar bipers | Operador y Recepción | Cancelar el turno de clientes que no llegaron |
| Gestionar juegos | Operador y Recepción | Crear y editar juegos/atracciones |

---

## 7. Guía de cada panel

### 7.1 Panel Recepción (`/recepcion.html`)
**Quién lo usa:** La persona en la entrada que registra a los grupos.

**Qué puede hacer:**
- Seleccionar el juego al que va el grupo
- Ver duración de la sesión y límite de personas (configurado por el admin)
- Ingresar número de biper (manual o automático)
- Ingresar nombre del grupo/familia
- Ingresar cantidad de personas (limitado por el mínimo/máximo del juego)
- Ver estimación de tiempo de espera antes de registrar
- Ver la cola actual separada por pestañas (una por juego)
- **Si tiene permiso:** Llamar al siguiente grupo (solo el primero de la cola)
- **Si tiene permiso:** Finalizar un turno en curso
- Recibir notificaciones cuando el operador finaliza un turno

**Reglas importantes:**
- Solo se puede llamar al primer grupo de la cola (en orden de llegada)
- Si el juego ya tiene alguien jugando, pide confirmación antes de llamar al siguiente
- Las notificaciones del operador aparecen como toast (no interrumpen el trabajo)

---

### 7.2 Panel Operador (`/operador.html`)
**Quién lo usa:** La persona que atiende cada juego/atracción.

**Qué puede hacer:**
- Ver la cola de su atracción asignada (o filtrar por atracción)
- Llamar al siguiente grupo (activa el biper físico)
- Finalizar un turno cuando termina
- Ver timer en tiempo real de cuánto lleva jugando cada grupo
- **Si tiene permiso:** Cancelar bipers de clientes que no llegaron

**Indicadores visuales:**
- 🟢 Verde: grupo dentro del tiempo estimado
- 🔴 Rojo parpadeante: tiempo excedido

---

### 7.3 Panel Admin (`/admin.html`)
**Quién lo usa:** El dueño o gerente del negocio.

**Tab Estadísticas** *(requiere módulo habilitado)*
- Total de turnos, finalizados, en espera y tiempo promedio de espera
- Gráfico de turnos por atracción (dona)
- Gráfico de turnos por día (línea)
- Gráfico de actividad por hora (barras)
- Gráfico de actividad por operador (barras agrupadas)
- Tabla resumen por operador con llamados, finalizados y tiempo promedio
- Filtro por período: Hoy / 7 días / 30 días / Todo

**Tab Usuarios**
- Ver todos los usuarios con su rol, atracción asignada y permisos
- Crear nuevos usuarios
- Editar datos y permisos de usuarios existentes
- Desactivar usuarios (no se borran, quedan en el historial)

---

### 7.4 Gestión de Juegos (`/juegos.html`)
**Quién lo usa:** Admin (o usuario con permiso de gestión de juegos).

**Qué puede configurar por juego:**
- Nombre del juego/atracción
- Duración estimada de la sesión (en minutos) — usada para calcular tiempos de espera
- Mínimo de personas por grupo
- Máximo de personas por grupo
- Activar/desactivar el juego (los inactivos no aparecen en recepción ni en operador)

---

### 7.5 Pantalla TV (`/cola.html`)
**Sin login requerido.** Pensada para mostrar en un televisor en la sala de espera.

**Qué muestra:**
- Columna izquierda: grupos jugando ahora (con barra de progreso del tiempo)
- Columna derecha: cola de espera con tiempo estimado
- Filtros por juego en la barra superior
- Reloj en tiempo real
- Se actualiza automáticamente con cada cambio (sin recargar la página)

---

### 7.6 Panel Superadmin (`/superadmin.html`)
**Quién lo usa:** El desarrollador (vos).

Muestra todas las cuentas admin con 4 toggles por cuenta:

| Módulo | Efecto cuando está OFF |
|---|---|
| 📊 Estadísticas y gráficos | El tab de stats muestra "Módulo no disponible" |
| 🎮 Gestión de juegos | El link "Juegos" desaparece del navbar |
| ❌ Cancelar bipers | El admin no puede dar ese permiso a sus usuarios |
| 📣 Llamar y finalizar desde recepción | El admin no puede dar ese permiso a sus usuarios |

El **plan** se calcula automáticamente:
- `Plan Completo` → 4/4 módulos activos
- `X/4 módulos` → algunos módulos activos
- `Sin módulos` → 0/4 módulos activos

---

## 8. Cómo acceder desde otros dispositivos

### Encontrar la IP de la PC servidor

1. Abrí CMD (Win + R → `cmd` → Enter)
2. Escribí: `ipconfig`
3. Buscá **"Dirección IPv4"** debajo de tu adaptador de red
4. Ejemplo: `192.168.1.50`

### Abrir el puerto en el Firewall de Windows

**Opción A — Interfaz gráfica:**
1. Buscá "Windows Defender Firewall" en el menú inicio
2. Click en "Configuración avanzada"
3. "Reglas de entrada" → "Nueva regla"
4. Puerto → TCP → `3000` → Permitir → Guardar como `Sistema Turnos`

**Opción B — CMD como administrador:**
```
netsh advfirewall firewall add rule name="Sistema Turnos" dir=in action=allow protocol=TCP localport=3000
```

### Acceso desde cada dispositivo

Todos los dispositivos deben estar en la **misma red WiFi**.

| Dispositivo | URL |
|---|---|
| PC servidor | `http://localhost:3000` |
| Celular/tablet | `http://[IP-DE-LA-PC]:3000` |
| Segunda PC | `http://[IP-DE-LA-PC]:3000` |
| TV (pantalla) | `http://[IP-DE-LA-PC]:3000/cola.html` |

> ⚠️ Si el navegador del celular redirige a `https://`, escribir la URL completa con `http://` explícitamente. Si persiste, usar Firefox.

---

## 9. Configuración inicial para el cliente

Seguir este checklist al entregar el sistema:

### ✅ Lista de entrega

**1. Configurar juegos/atracciones**
- [ ] Ir a `/juegos.html` como admin
- [ ] Crear cada atracción con su nombre, duración, mínimo y máximo de personas
- [ ] Desactivar las atracciones de ejemplo que no correspondan

**2. Crear usuarios**
- [ ] Ir a Admin → Tab Usuarios
- [ ] Crear usuario para cada operador (rol: Operador, atracción asignada)
- [ ] Crear usuario/s para recepción (rol: Recepción, con permisos según necesidad)
- [ ] Cambiar la contraseña del admin por defecto

**3. Configurar permisos según el plan contratado**
- [ ] Iniciar sesión como `superadmin`
- [ ] Activar o desactivar módulos para la cuenta admin del cliente

**4. Configurar acceso en red**
- [ ] Anotar la IP local de la PC servidor
- [ ] Abrir el puerto 3000 en el firewall
- [ ] Probar acceso desde celular/tablet
- [ ] Configurar la TV con la URL de cola: `http://[IP]:3000/cola.html`

**5. Arranque automático (opcional)**
- [ ] Configurar el servidor para que arranque solo al encender la PC (ver sección 11)

**6. Prueba final**
- [ ] Registrar un grupo desde recepción
- [ ] Llamar el turno desde el operador
- [ ] Verificar que aparece en la pantalla TV
- [ ] Finalizar el turno y confirmar que llega la notificación a recepción

---

## 10. Control de módulos por plan (Superadmin)

Como desarrollador, cobrás distintos planes a cada cliente. Desde `/superadmin.html` controlás qué tiene habilitado cada uno:

### Ejemplo de planes sugeridos

| Plan | 📊 Estadísticas | 🎮 Gestión juegos | ❌ Cancelar | 📣 Llamar desde recepción |
|---|:---:|:---:|:---:|:---:|
| **Básico** | ❌ | ❌ | ❌ | ❌ |
| **Estándar** | ❌ | ✅ | ✅ | ❌ |
| **Profesional** | ✅ | ✅ | ✅ | ✅ |

Podés armar cualquier combinación según lo que negocie con cada cliente.

### Cómo agregar un nuevo cliente

1. Iniciar sesión como `admin` en el sistema
2. Ir a **Usuarios** → **Nuevo Usuario**
3. Crear la cuenta con rol `Administrador`
4. Iniciar sesión como `superadmin`
5. En el panel, buscar la nueva cuenta y activar los módulos correspondientes

---

## 11. Arrancar el servidor automáticamente

Para que el servidor arranque solo cuando encienden la PC (sin tener que abrir CMD):

### Opción A — Tarea programada de Windows

1. Abrí el **Programador de tareas** (buscarlo en inicio)
2. "Crear tarea básica" → nombre: `Sistema de Turnos`
3. Desencadenador: **Al iniciar sesión**
4. Acción: **Iniciar un programa**
   - Programa: `node`
   - Argumentos: `server.js`
   - Iniciar en: `C:\Sistema Universal` (o donde esté la carpeta)
5. Finalizar

### Opción B — Archivo .bat en el Inicio de Windows

1. Crear un archivo `arrancar.bat` dentro de la carpeta con este contenido:
```bat
@echo off
cd /d "C:\Sistema Universal"
node server.js
```
2. Copiar un acceso directo de ese .bat en:
```
C:\Users\[usuario]\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
```

---

## 12. Solución de problemas frecuentes

### ❌ "EADDRINUSE: address already in use"
**Problema:** El puerto 3000 ya está siendo usado (el servidor estaba corriendo).
**Solución:** Abrir el Administrador de Tareas → buscar `node.exe` → finalizar tarea → volver a ejecutar `npm start`.

### ❌ "Cannot find module" al ejecutar npm start
**Problema:** Las dependencias no están instaladas.
**Solución:** Ejecutar `npm install` dentro de la carpeta del proyecto.

### ❌ El celular no puede conectarse
**Causas posibles:**
1. No están en la misma red WiFi
2. El firewall de Windows está bloqueando el puerto 3000
3. El navegador fuerza HTTPS

**Solución:** Verificar que la URL empiece con `http://` (no https). Abrir el puerto en el firewall. Probar con Firefox si Chrome fuerza HTTPS.

### ❌ La base de datos no guarda cambios
**Problema:** La carpeta del sistema no tiene permisos de escritura.
**Solución:** Click derecho en la carpeta → Propiedades → Seguridad → dar control total al usuario actual.

### ❌ Los gráficos no cargan
**Causas posibles:**
1. La cuenta admin no tiene habilitado el módulo de estadísticas (verificar en superadmin)
2. No hay internet para cargar Chart.js desde CDN

**Solución para sin internet:** Descargar Chart.js localmente y reemplazar el link CDN en `admin.html`.

### ❌ El operador no puede llamar turnos
**Problema:** El rol operador siempre tiene ese permiso. Verificar que el usuario tiene rol `operador` y no otro.

### ❌ La recepcionista no ve los juegos en el formulario
**Problema:** No hay juegos activos creados.
**Solución:** Ir a `/juegos.html` como admin y crear/activar los juegos.

---

## 13. Referencia de URLs

Con el servidor corriendo en `http://[IP]:3000`:

| URL | Descripción | Requiere login |
|---|---|---|
| `/login.html` | Pantalla de inicio de sesión | No |
| `/superadmin.html` | Panel del desarrollador | Sí (superadmin) |
| `/admin.html` | Panel del administrador | Sí (admin) |
| `/operador.html` | Panel del operador | Sí (operador) |
| `/recepcion.html` | Panel de recepción | Sí (recepcion) |
| `/juegos.html` | Gestión de juegos | Sí (con permiso) |
| `/cola.html` | Pantalla TV pública | No |

### Usuarios por defecto

| Usuario | Contraseña | Panel |
|---|---|---|
| `superadmin` | `super123` | `/superadmin.html` |
| `admin` | `admin123` | `/admin.html` |

> Recordar cambiar estas contraseñas antes de la entrega al cliente.

---

*Sistema Universal de Gestión de Turnos — Documentación v1.0*
