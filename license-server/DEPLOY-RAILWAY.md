# Deploy Manual en Railway — Servidor de Licencias

## Pasos (5 minutos)

### 1. Subir el código a GitHub (solo la carpeta license-server)

Opción A — Subir desde Railway directamente:
- En Railway → New Project → "Deploy from GitHub Repo"
- Si no tenés el repo de license-server en GitHub, primero crealo

Opción B — Deploy por CLI (cuando tengas el token correcto):
```bash
cd license-server
railway login
railway init
railway up
```

### 2. Variables de entorno a configurar en Railway

En tu proyecto Railway → Variables → agregar estas:

| Variable | Valor |
|----------|-------|
| `PORT` | `4000` |
| `JWT_PRIVATE_KEY` | (contenido de keys/private.key, reemplazar saltos de línea por \n) |
| `ADMIN_JWT_SECRET` | (string aleatorio, mínimo 32 caracteres) |
| `LICENSE_ADMIN_PASS` | (tu contraseña de admin del panel de licencias) |

### 3. Clave privada como variable de entorno

El contenido de `keys/private.key` debe ir en una sola línea con \n:

```
-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhki...\n-----END PRIVATE KEY-----
```

### 4. Verificar que funciona

Una vez desplegado Railway te da una URL como:
`https://sistema-turnos-licencias.up.railway.app`

Verificar con:
```
GET https://tu-url.railway.app/health
→ { "ok": true }
```

### 5. Actualizar la URL en la app Electron

En `electron/license.js` línea 21:
```js
const LICENSE_SERVER_URL = 'https://tu-url.railway.app';
```

Luego rebuild:
```bash
npm run dist
```
