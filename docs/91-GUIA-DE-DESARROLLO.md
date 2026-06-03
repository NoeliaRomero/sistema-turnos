# 91 — GUÍA DE DESARROLLO

> Stack real: Electron + Node.js + Express + SQLite + Socket.io.
> **NO** se usa NestJS ni PostgreSQL (eran parte de un template ajeno).

---

## 1. REQUISITOS PREVIOS

| Herramienta | Versión | Para qué |
|-------------|---------|----------|
| Node.js | 18+ (probado con 24) | Runtime |
| npm | 8+ | Dependencias |
| Windows | 10/11 x64 | Plataforma objetivo |
| VS Code | última | Editor |
| Visual Studio Build Tools | — | Compilar módulos nativos (better-sqlite3, keytar) |

## 2. INSTALACIÓN DEL PROYECTO

```powershell
cd "C:\Users\None\Desktop\sistema-turnos-desktop"
npm install
# Recompilar módulos nativos para Electron:
npx @electron/rebuild -f -w better-sqlite3,keytar
```

## 3. DÓNDE ESCRIBIR CÓDIGO

| Quiero… | Voy a… |
|---------|--------|
| Agregar un endpoint API | `server/routes/<modulo>.js` + registrarlo en `server/server.js` |
| Cambiar el esquema de datos | `server/db/database.js` (tabla + migración) |
| Cambiar una pantalla | `public/<vista>.html` + `public/js/<vista>.js` |
| Tocar arranque/licencia/red | `electron/main.js` / `electron/license.js` |
| Cambiar el instalador | `package.json` (sección `build`) + `scripts/` |

## 4. CÓMO CREAR UN MÓDULO NUEVO (ejemplo: reportes)

1. Crear `server/routes/reportes.js`:
```js
const router = require('express').Router();
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
router.use(requireAuth('admin'));
router.get('/', (req, res) => { /* ... */ res.json([]); });
module.exports = router;
```
2. Registrar en `server/server.js`:
```js
appExpress.use('/api/reportes', require('./routes/reportes'));
```
3. Crear la vista en `public/` si necesita UI.
4. Si toca datos nuevos, agregar tabla + migración en `database.js`.

## 5. CÓMO EJECUTAR EL BACKEND (standalone, sin Electron)

> Útil para desarrollar la API rápido. Requiere que `better-sqlite3` esté compilado
> para tu Node (no para Electron). Para esto conviene una copia separada o usar el
> modo Electron dev.

```powershell
# Modo desarrollo con Electron (recomendado):
cd "C:\Users\None\Desktop\sistema-turnos-desktop"
$env:NODE_ENV="development"
npm run dev
```

## 6. CÓMO EJECUTAR EL FRONTEND

El frontend lo sirve Express (no es un proyecto separado). Al correr `npm run dev`,
Electron levanta el server en `http://127.0.0.1:3000` y abre la ventana.
Para probar en navegador externo: `http://flowturn.local:3000` (misma WiFi).

## 7. BASE DE DATOS (SQLite — NO PostgreSQL)

> ⚠️ El template pedía "cómo levantar PostgreSQL". **FlowTurn usa SQLite**, que es un
> archivo, no un servidor. No hay que "levantar" nada.

- Ubicación en runtime: `%APPDATA%\flowturn\turnos.db`.
- Ubicación en dev (sin Electron): `server/db/turnos.db`.
- Inspeccionar: **DB Browser for SQLite** (gratis) → abrir el `.db`.
- El esquema y los datos seed se crean solos al iniciar (`database.js`).

## 8. CÓMO PROBAR CAMBIOS

1. `npm run dev` (modo desarrollo, DevTools habilitados).
2. Probar el flujo afectado en los roles correspondientes.
3. Si tocaste el server o Socket.io: probar también desde el celular en la red local.
4. Si tocaste arranque/licencia/build: hacer un build de prueba (`--dir`).

## 9. CREDENCIALES POR DEFECTO (dev)

| Rol | Usuario | Contraseña |
|-----|---------|------------|
| Superadmin | `superadmin` | `super123` |
| Admin | `admin` | `admin123` |

> Cambiar antes de entregar a un cliente.

## 10. BUENAS PRÁCTICAS DEL PROYECTO

- Mantener JS vanilla (no introducir frameworks SPA sin justificación).
- Cuidar el **encoding UTF-8** (no usar PowerShell replace sin `UTF8Encoding` sin BOM).
- No mezclar lógica de licencias con lógica de negocio.
- Cambios de esquema → siempre con migración (`ALTER TABLE ... try/catch`).
- Commits pequeños, rama por subhilo (ver `90`).
