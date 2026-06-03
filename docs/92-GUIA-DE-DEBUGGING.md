# 92 — GUÍA DE DEBUGGING

> Stack real: Electron + Express + SQLite + Socket.io.
> El template mencionaba "debugging de NestJS/PostgreSQL" → **no aplica**; se documenta
> el debugging real del proyecto.

---

## 1. VS CODE — CONFIGURACIÓN BÁSICA

Crear `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Electron Main (dev)",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
      "windows": { "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron.cmd" },
      "args": ["."],
      "env": { "NODE_ENV": "development" },
      "console": "integratedTerminal"
    }
  ]
}
```

## 2. BREAKPOINTS

- **Proceso main (`electron/`)**: usar la config de arriba; los breakpoints funcionan
  directamente en `main.js`, `license.js`, `machineId.js`.
- **Backend (`server/`)**: corre dentro del main process, así que los breakpoints en
  `routes/`, `database.js` también funcionan con esa config.
- **Frontend (`public/js/`)**: usar DevTools de la ventana (F12 en modo dev) → Sources.

## 3. LOGS

- El `console.log` del proceso main aparece en la **terminal** donde corrés `npm run dev`.
- El `console.log` del frontend aparece en **DevTools → Console** de la ventana.
- Logs clave ya existentes:
  - `[License] ✅ Válida — <empresa>`
  - `[Migration] Datos migrados...`
  - `[Firewall] Puerto 3000 abierto...`
  - `[mDNS] Publicado como: http://flowturn.local:3000`

## 4. DEBUGGING DEL BACKEND (Express)

- Verificar que el server levantó: log `Servidor en http://...:3000`.
- Probar endpoints con el navegador o `curl`/PowerShell `Invoke-RestMethod`.
- Revisar `req.session.usuario` para problemas de permisos/roles.
- Errores 401/403 → revisar `middleware/auth.js` (`requireAuth`, `requirePermission`).

## 5. DEBUGGING DE SQLite (NO PostgreSQL)

- Abrir el `.db` con **DB Browser for SQLite**.
- Ubicación runtime: `%APPDATA%\flowturn\turnos.db`.
- Errores comunes:
  - `NODE_MODULE_VERSION mismatch` → recompilar: `npx @electron/rebuild -f -w better-sqlite3`.
  - BD bloqueada → cerrar otras instancias de la app; revisar archivos `-wal`/`-shm`.
- Para ver datos en vivo: consultar las tablas `turnos`, `usuarios`, `atracciones`.

## 6. DEBUGGING DE WEBSOCKETS (Socket.io)

- En el frontend, loguear eventos:
```js
socket.onAny((event, ...args) => console.log('[socket]', event, args));
```
- Verificar conexión en DevTools → Network → WS.
- Problemas típicos:
  - La pantalla pública no se actualiza → revisar que el evento se emite (`io.emit(...)`)
    y que el cliente está suscrito.
  - Desde celular no conecta → revisar CSP y que el server escuche en `0.0.0.0`.

## 7. DEBUGGING DE LICENCIA / ACTIVACIÓN

- Verificar fingerprint actual:
```powershell
node -e "const {getCurrentFingerprint}=require('./electron/license'); console.log(getCurrentFingerprint())"
```
- Comparar con el `hardwareFingerprint` dentro de `license.lic`.
- Errores típicos:
  - `HARDWARE_MISMATCH` → el `.lic` fue generado para otra PC (regenerar).
  - `NO_LICENSE` → el `.lic` no está en `%APPDATA%\flowturn\`.
  - `INVALID_SIGNATURE` → el archivo fue alterado o la clave pública no coincide.

## 8. DEBUGGING DE RED LOCAL

- Verificar IP local: `ipconfig` o el log de mDNS.
- Probar desde celular: `http://flowturn.local:3000` o `http://<IP>:3000`.
- Si no conecta:
  - Firewall: confirmar regla "FlowTurn" (la app la crea sola si corre como admin).
  - mDNS no resuelve en Android viejo → usar la IP directa.

## 9. CHECKLIST RÁPIDO DE DIAGNÓSTICO

| Síntoma | Primer lugar a mirar |
|---------|---------------------|
| No abre, pide activación siempre | Ruta del `.lic` (`%APPDATA%\flowturn`) |
| Error de módulo nativo | `@electron/rebuild` |
| 401/403 en API | `middleware/auth.js` + sesión |
| Pantalla no actualiza | Eventos Socket.io |
| Celular no conecta | Firewall + `0.0.0.0` + CSP |
| Acentos rotos en UI | Encoding UTF-8 del HTML |
