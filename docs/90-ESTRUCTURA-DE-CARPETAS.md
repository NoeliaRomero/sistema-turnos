# 90 — ESTRUCTURA DE CARPETAS Y REGLAS DE COLABORACIÓN

> Documenta la estructura real del proyecto **FlowTurn Desktop**
> (`sistema-turnos-desktop`) y las reglas para trabajo colaborativo multi-subhilo.

---

## 1. ESTRUCTURA PROPUESTA / REAL

```
sistema-turnos-desktop/
│
├── electron/                  ← Shell de escritorio (proceso main)
│   ├── main.js                ← Orquestador: licencia, server, ventana, mDNS, firewall, migración
│   ├── license.js             ← Verificación offline de licencia (RSA + hardware)
│   ├── machineId.js           ← Fingerprint de hardware (WMIC)
│   └── preload.js             ← Bridge seguro main ↔ renderer (contextIsolation)
│
├── server/                    ← Backend Express embebido
│   ├── server.js              ← App Express + Socket.io (exporta createApp)
│   ├── db/
│   │   └── database.js        ← SQLite (better-sqlite3), tablas, migraciones, seed
│   ├── middleware/
│   │   └── auth.js            ← requireAuth / requirePermission
│   └── routes/
│       ├── auth.js            ← login/logout/sesión
│       ├── turnos.js          ← turnos, cola, llamar, finalizar, cancelar
│       ├── atracciones.js     ← CRUD juegos/atracciones
│       ├── usuarios.js        ← CRUD usuarios, roles, permisos
│       ├── stats.js           ← estadísticas
│       └── superadmin.js      ← feature flags
│
├── public/                    ← Frontend (servido por Express)
│   ├── login.html
│   ├── activation.html        ← Pantalla de activación de licencia
│   ├── admin.html             ← Panel admin (stats + usuarios + juegos)
│   ├── recepcion.html
│   ├── operador.html
│   ├── pantalla.html          ← Pantalla pública (TV)
│   ├── superadmin.html
│   ├── index.html
│   └── js/                    ← JS de cada vista (admin.js, recepcion.js, etc.)
│
├── license-server/            ← Servidor de licencias (nube, OPCIONAL/deprecado)
│   ├── server.js
│   ├── db/database.js
│   ├── routes/licenses.js
│   └── scripts/genKeys.js     ← Genera par RSA (una sola vez)
│
├── tools/                     ← Herramientas del desarrollador (NO distribuir)
│   ├── generate-license.js    ← Genera license.lic (usa clave privada)
│   ├── get-fingerprint.js     ← Obtiene fingerprint de la PC del cliente
│   └── README.txt
│
├── scripts/
│   ├── build.js               ← Build maestro (limpia, ofusca, empaqueta)
│   └── obfuscate.js           ← Ofuscación del JS frontend
│
├── build/                     ← Recursos del instalador
│   ├── icon.ico               ← Ícono FlowTurn (256x256)
│   └── license.txt            ← EULA
│
├── keys/                      ← Par RSA (NUNCA subir a Git)
│   ├── private.key            ← SOLO en tu PC
│   └── public.key             ← Embebida en electron/license.js
│
├── dist/                      ← Salida del build (FlowTurn Setup x.x.x.exe)
└── package.json               ← Config Electron Builder + dependencias
```

> Nota: el repositorio GitHub `NoeliaRomero/sistema-turnos` contiene la versión web
> original (`Sistema Universal`) más `license-server/` y `docs/`. El proyecto desktop
> (`sistema-turnos-desktop`) es la evolución empaquetada.

---

## 2. RESPONSABILIDADES DE CADA CARPETA

| Carpeta | Responsable principal | Contenido |
|---------|----------------------|-----------|
| `electron/` | Subhilo Licencias / Shell | Arranque, licencia, red, ventana |
| `server/routes/turnos.js` | `40-GESTION` | Lógica de turnos |
| `server/routes/atracciones.js`, `usuarios.js`, `superadmin.js` | `20-ROLES` | Roles, permisos, atracciones |
| `server/routes/stats.js` | `20` (lectura de `40`) | Estadísticas |
| `server/db/database.js` | Compartido (cambios coordinados) | Esquema + migraciones |
| `public/js/recepcion.js`, `operador.js`, `cola.js`, `pantalla.js` | `40-GESTION` | UI de turnos |
| `public/js/admin.js`, `juegos.js`, `superadmin.js` | `20-ROLES` | UI de gestión |
| `tools/`, `keys/` | Subhilo Licencias | Generación de licencias |
| `scripts/`, `build/`, `package.json (build)` | `93-COMPILACION` | Build/instalador |
| `license-server/` | `60-SERVIDOR` (deprecado) | Servidor de licencias |

---

## 3. DEPENDENCIAS PERMITIDAS

- `electron/` → puede importar `server/server.js`. ✅
- `server/routes/*` → pueden importar `server/db/database.js` y `middleware/auth.js`. ✅
- `public/js/*` → solo hablan con la API vía `fetch` y Socket.io. ✅
- `tools/` → usa `keys/private.key`. ✅

## 4. DEPENDENCIAS PROHIBIDAS

- ❌ `server/` NO debe importar nada de `electron/` (debe poder correr standalone).
- ❌ `public/js/*` NO debe acceder a Node.js directamente (solo vía API/preload).
- ❌ La lógica de negocio (`server/`) NO debe contener lógica de licencias.
- ❌ Nada debe importar `keys/private.key` salvo `tools/`.
- ❌ El cliente (`electron/`) NO debe depender de `license-server/` para operar.

---

## 5. MATRIZ DE PROPIEDAD POR SUBHILO

| Subhilo | Carpetas/archivos que PUEDE editar | NO puede editar |
|---------|-----------------------------------|-----------------|
| 10-BUGS | Todos (con coordinación) | Esquema/licencia/build sin acuerdo |
| 20-ROLES | `usuarios.js`, `atracciones.js`, `superadmin.js`, `admin.js`, `juegos.js`, `superadmin.js`, `middleware/auth.js` | `turnos.js`, `electron/` |
| 40-TURNOS | `turnos.js`, `recepcion.js`, `operador.js`, `cola.js`, `pantalla.js` | roles/permisos, `electron/` |
| 50-LOGS | `license-server` events, (futuro) `audit_log` | lógica de negocio |
| 60-SERVIDOR | `license-server/`, `/health` | cliente Electron |
| 70-BIPERS | `biper_numero` en turnos (coord. con 40) | orden de cola |
| 80-BACKUPS | nuevos archivos backup, UI backup | esquema, negocio |
| Licencias | `electron/license.js`, `tools/`, `keys/` | negocio |
| 93-COMPILACION | `scripts/`, `build/`, `package.json` build | código de módulos |

---

## 6. MATRIZ DE DEPENDENCIAS ENTRE SUBHILOS

| ↓ depende de → | 20 | 40 | 50 | 70 | 80 | Lic |
|----------------|----|----|----|----|----|----|
| **20-ROLES**   | —  | —  | —  | —  | —  | —  |
| **40-TURNOS**  | ✔  | —  | —  | ✔  | —  | —  |
| **50-LOGS**    | ✔  | ✔  | —  | —  | —  | —  |
| **70-BIPERS**  | ✔  | ✔  | —  | —  | —  | —  |
| **80-BACKUPS** | ✔  | ✔  | ✔  | —  | —  | —  |
| **Licencias**  | —  | —  | —  | —  | —  | —  |

✔ = "la fila depende de la columna".

---

## 7. MATRIZ DE IMPACTO DE CAMBIOS

| Si cambiás… | Impacta a… | Acción obligatoria |
|-------------|-----------|--------------------|
| `server/db/database.js` (esquema) | 20, 40, 50, 70, 80 | Migración + avisar a todos |
| `middleware/auth.js` | 20, 40, 10 | Probar los 4 roles |
| Eventos Socket.io | 40, pantalla pública | Probar PC ↔ celular |
| `electron/main.js` | Arranque, red, licencia | Rebuild + probar instalación |
| `package.json` build | Instalador | Rebuild completo |
| `electron/license.js` / `keys/` | Activación | Probar activación limpia |

---

## 8. ESTRATEGIA GIT PARA TRABAJO COLABORATIVO

### Ramas
```
main                    ← estable, siempre compilable
  └─ develop            ← integración
      ├─ fix/<bug>          (subhilo 10)
      ├─ feat/roles-<x>     (subhilo 20)
      ├─ feat/turnos-<x>    (subhilo 40)
      ├─ feat/logs-<x>      (subhilo 50)
      ├─ feat/bipers-<x>    (subhilo 70)
      ├─ feat/backups-<x>   (subhilo 80)
      └─ chore/build-<x>    (subhilo 93)
```

### Reglas
1. Nadie commitea directo a `main`.
2. Cada subhilo trabaja en su rama y abre PR hacia `develop`.
3. Cambios en archivos compartidos (`database.js`, `auth.js`, `turnos.js`) requieren
   **revisión del subhilo dueño** antes de merge.
4. `main` solo recibe merges desde `develop` cuando el `.exe` compila y se probó.
5. `keys/`, `dist/`, `node_modules/`, `*.db` están en `.gitignore` (nunca subir).

### Integración continua (propuesta)
- En cada PR a `develop`: ejecutar `npm install` + `electron-builder --win --x64 --dir`
  (build sin instalador) para verificar que compila.
- Lint/format opcional.
- Merge a `main` solo con build verde.

---

## 9. PROTOCOLO ANTI-CONFLICTOS

- **Un dueño por archivo crítico.** `turnos.js` → 40. `database.js` → cambios siempre
  vía PR coordinado.
- Antes de editar un archivo de otro subhilo, abrir issue y esperar OK.
- Commits pequeños y frecuentes para minimizar conflictos de merge.
- Rebase frecuente de la rama propia sobre `develop`.
