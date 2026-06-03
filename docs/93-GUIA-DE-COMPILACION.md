# 93 — GUÍA DE COMPILACIÓN Y DISTRIBUCIÓN

> Cómo pasar del código fuente al instalador `FlowTurn Setup x.x.x.exe`.

---

## 1. INSTALACIÓN DE DEPENDENCIAS

```powershell
cd "C:\Users\None\Desktop\sistema-turnos-desktop"
npm install
npx @electron/rebuild -f -w better-sqlite3,keytar
```

## 2. GENERAR EL PAR DE CLAVES RSA (UNA SOLA VEZ)

```powershell
node license-server/scripts/genKeys.js
```
- Genera `keys/private.key` (queda SOLO en tu PC) y `keys/public.key`.
- Copiar el contenido de `public.key` dentro de `electron/license.js` → `PUBLIC_KEY`.
- ⚠️ `keys/` está en `.gitignore`. **Nunca subir la clave privada.**

## 3. BUILD DEL INSTALADOR

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"   # sin code signing (por ahora)
$env:WIN_CSC_LINK = ""
node_modules\.bin\electron-builder.cmd --win --x64
```
- Salida: `dist\FlowTurn Setup 1.0.0.exe`
- Versión controlada por `version` en `package.json`.

### Build sin instalador (para probar rápido)
```powershell
node_modules\.bin\electron-builder.cmd --win --x64 --dir
# Resultado: dist\win-unpacked\FlowTurn.exe
```

### Alternativa con electron-packager (si NSIS falla)
```powershell
npx electron-packager . "FlowTurn" --platform=win32 --arch=x64 --out=dist --overwrite --asar --icon=build/icon.ico
```

## 4. CONFIGURACIÓN CLAVE (package.json → build)

| Campo | Valor | Efecto |
|-------|-------|--------|
| `productName` | `FlowTurn` | Nombre del producto/instalador |
| `appId` | `com.rrtechnologies.flowturn` | ID único de la app |
| `win.publisherName` | `RR Technologies` | Editor mostrado |
| `nsis.shortcutName` | `FlowTurn` | Acceso directo |
| `win.requestedExecutionLevel` | `requireAdministrator` | Permite abrir puerto en firewall |
| `asar` | `true` | Empaqueta el código |
| `asarUnpack` | better-sqlite3, keytar, bonjour-service | Módulos nativos fuera del asar |

## 5. EJECUTAR (PRODUCCIÓN)

1. Doble clic en `FlowTurn Setup 1.0.0.exe`.
2. Si Windows alerta (editor desconocido): "Más información" → "Ejecutar de todas formas".
   *(Se elimina al comprar certificado de code signing.)*
3. La app instala en `%LOCALAPPDATA%\Programs\FlowTurn\`.
4. Datos en `%APPDATA%\flowturn\`.

## 6. DESPLIEGUE EN LA PC DEL CLIENTE

```
1. Conectar por TeamViewer/AnyDesk.
2. Instalar el .exe.
3. Correr get-fingerprint.js en la PC del cliente → copiar el código.
4. En TU PC: node tools/generate-license.js "<fingerprint>" "Empresa" "Dueño" "email"
5. Copiar license.lic a %APPDATA%\flowturn\  (o usar el botón "Seleccionar archivo de licencia").
6. Abrir FlowTurn → funciona offline para siempre.
```

## 7. SERVIDOR DE LICENCIAS (OPCIONAL — modelo multi-cliente)

> Para cliente único NO es necesario. Solo si se ofrece variante multi-cliente.

```powershell
cd license-server
npm install
# Variables: JWT_PRIVATE_KEY, ADMIN_JWT_SECRET, LICENSE_ADMIN_PASS, PORT
npm start
# O desplegar en Railway (deploy desde GitHub, root dir = license-server)
```

## 8. CHECKLIST PRE-ENTREGA

- [ ] `version` actualizada en `package.json`
- [ ] Clave pública correcta en `electron/license.js`
- [ ] Ícono `build/icon.ico` (256x256) actualizado
- [ ] `npm run dev` funciona sin errores
- [ ] Build genera el `.exe` sin errores
- [ ] Instalación limpia probada en una PC sin la app
- [ ] Activación con `license.lic` probada
- [ ] Acceso desde celular probado (`flowturn.local`)
- [ ] Credenciales por defecto cambiadas para el cliente
- [ ] (Recomendado) Certificado de code signing aplicado

## 9. PENDIENTE: CODE SIGNING

Para eliminar la alerta de Windows Defender:
- Comprar certificado EV de code signing (~$350/año).
- Configurar `win.certificateFile` / `win.certificatePassword` o variables CSC.
- Rebuild.
