# 94 — GUÍA PARA NUEVOS DESARROLLADORES (ONBOARDING)

> Si nunca viste FlowTurn, empezá por acá. En 30 minutos tenés el proyecto corriendo
> y entendés la arquitectura.

---

## 1. ¿QUÉ ES FlowTurn? (1 minuto)

Aplicación de **escritorio Windows** para gestionar **turnos en negocios de
entretenimiento** (paintball, karting, etc.). Desarrollada por **RR Technologies**.

- Se instala en una PC y funciona **sin internet**.
- Otras pantallas (celular, tablet, otra PC) se conectan por **WiFi local**.
- Se vende con **licencia perpetua** (pago único). La licencia es un archivo firmado
  que solo funciona en la PC para la que fue generado.

## 2. STACK (lo que necesitás saber)

| Capa | Tecnología |
|------|-----------|
| Escritorio | Electron |
| Backend | Node.js + Express |
| Frontend | HTML + Bootstrap 5 + JS vanilla |
| Base de datos | SQLite (better-sqlite3) |
| Tiempo real | Socket.io |
| Licencia | RSA + fingerprint de hardware |

> ❗ No usamos NestJS ni PostgreSQL (aparecían en un template viejo, ignorarlos).

## 3. INSTALAR Y EJECUTAR (10 minutos)

```powershell
# 1. Clonar
git clone https://github.com/NoeliaRomero/sistema-turnos.git
cd sistema-turnos-desktop   # (proyecto desktop)

# 2. Dependencias
npm install
npx @electron/rebuild -f -w better-sqlite3,keytar

# 3. Correr en modo desarrollo
$env:NODE_ENV="development"
npm run dev
```

En dev no se exige licencia/activación para trabajar (DevTools habilitados).
Login dev: `admin` / `admin123` · superadmin: `superadmin` / `super123`.

## 4. ENTENDER EL FLUJO (5 minutos)

```
Electron (main.js)
  → valida licencia (en prod)
  → levanta Express en 127.0.0.1:3000
  → abre ventana apuntando a ese server

Usuario entra → login.html → según rol:
  admin       → admin.html      (estadísticas, usuarios, juegos)
  recepcion   → recepcion.html  (registrar grupos, llamar)
  operador    → operador.html   (ver cola, llamar/finalizar)
  superadmin  → superadmin.html (feature flags + licencias)
  pantalla TV → pantalla.html   (cola pública)

Todo en tiempo real vía Socket.io. Datos en SQLite local.
```

## 5. MAPA MENTAL DE CARPETAS

| Si querés tocar… | Andá a… |
|------------------|---------|
| Arranque / licencia / red | `electron/` |
| API / lógica de negocio | `server/routes/` |
| Base de datos / esquema | `server/db/database.js` |
| Pantallas | `public/*.html` + `public/js/` |
| Instalador | `package.json` (build) + `scripts/` |
| Generar licencias | `tools/` |

(Detalle completo en `90-ESTRUCTURA-DE-CARPETAS.md`.)

## 6. ROLES Y PERMISOS (lo esencial)

- Jerarquía: `superadmin` > `admin` > `operador` / `recepcion`.
- El **admin** gestiona usuarios, juegos y ve estadísticas.
- El **superadmin** (vos/RR Technologies) controla qué módulos tiene cada admin
  (feature flags) y gestiona licencias.
- Permisos finos: `permiso_llamar_turno`, `permiso_cancelar_turno`, `permiso_gestionar_juegos`.

## 7. REGLAS QUE NO HAY QUE ROMPER

- El sistema debe **funcionar offline** (no agregar dependencias online en el cliente).
- No mezclar **lógica de licencias** con lógica de negocio.
- `server/` debe poder correr **sin** `electron/`.
- Cambios de **esquema** → siempre con migración.
- Cuidar el **encoding UTF-8** (acentos).
- La **clave privada RSA** nunca se sube a Git ni se distribuye.

## 8. CÓMO COLABORAR

1. Leé el subhilo de tu área (`10`–`80`).
2. Creá tu rama desde `develop` (`feat/...` o `fix/...`).
3. Tocá solo los archivos de tu subhilo; si necesitás otro, coordiná (ver `90`).
4. Abrí PR a `develop`. Verificá que el `.exe` compila.
5. Merge a `main` solo con build verde y prueba manual.

## 9. DÓNDE SEGUIR LEYENDO

| Necesito… | Documento |
|-----------|-----------|
| Visión completa del proyecto | `00-PROYECTO-GENERAL.md` |
| Cómo desarrollar | `91-GUIA-DE-DESARROLLO.md` |
| Cómo debuggear | `92-GUIA-DE-DEBUGGING.md` |
| Cómo compilar | `93-GUIA-DE-COMPILACION.md` |
| Estructura y reglas Git | `90-ESTRUCTURA-DE-CARPETAS.md` |
| Mi área específica | `10`–`80` según corresponda |

## 10. PRIMER TICKET SUGERIDO (para calentar)

Implementar el **backup manual** (`80-SUBHILO-BACKUPS.md`): botón en admin que copia
`turnos.db` con `wal_checkpoint` previo. Es autocontenido, no toca lógica de negocio,
y te obliga a recorrer Electron + Express + SQLite + UI. Ideal para onboarding.
