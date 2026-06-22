# Sistema VIPER — Validación física por serial (Arduino)

Esta guía no asume conocimientos previos. Sigue los pasos en orden.

## 1. Configuración (puerto COM, velocidad, conexión con Arduino)

1. Conectá el Arduino a la PC por USB.
2. Iniciá sesión como **admin** y entrá a **Configuraciones del Sistema** (ícono ⚙️ en la barra superior).
3. En el menú lateral, seleccioná **Configuración del Sistema** (panel general).
4. En la tarjeta **Configuración Serial (Arduino)**:
   - **Puerto COM**: elegí el puerto donde está conectado el Arduino (ej. `COM3`). Si el sistema no detecta puertos automáticamente, el selector muestra `COM1`–`COM4` como referencia; podés escribir el puerto correcto si tu sistema operativo usa otra nomenclatura (ej. `/dev/ttyUSB0` en Linux).
   - **Baudios**: `115200` (valor recomendado y por defecto). El Arduino debe estar programado con el mismo valor.
   - **Estado de conexión**: indica si el servidor tiene actualmente abierta la conexión serial.
5. Hacé clic en **Guardar**. Esto no abre la conexión inmediatamente: la conexión se abre la primera vez que se envía una señal o un código RAW.

## 2. Validación (crear VIPER, enviar mensaje, respuestas esperadas)

1. En el menú lateral, seleccioná **VIPER**.
2. Hacé clic en **Agregar VIPER**, ingresá el código identificatorio (ej. `VIPER-001`) y guardá. El VIPER aparece en la tabla con estado **Pendiente**.
3. En la fila del VIPER, hacé clic en **Enviar señal**.
4. En el modal se muestra un mensaje editable, precargado con `READY_PARA_TEST_DE_CABLE`. Podés modificarlo para pruebas futuras. Confirmá con **Enviar**.
5. El estado del VIPER pasa a **Validando…**. El sistema:
   - Abre la conexión serial (si no estaba abierta).
   - Envía el mensaje al Arduino.
   - Queda escuchando la respuesta.
6. Respuestas esperadas del Arduino (vistas en el **Log Serial** del panel VIPER):
   - `LISTENING` → el Arduino está esperando la señal física del control/cable. El sistema sigue esperando, no hace nada más.
   - `RAW_CAPTURADO_POR_CABLE:<código>` → el Arduino capturó la señal. El sistema extrae el código completo (todo lo que sigue después de los dos puntos), lo guarda sin recortar ni modificar, y marca el VIPER como **Activo**.
   - Cualquier otra línea se registra en el log como mensaje informativo, pero no cambia el estado.
7. **Importante sobre el formato de los mensajes**: si usás el Monitor Serial de Arduino IDE, cada línea aparece con un timestamp al inicio, por ejemplo:
   ```
   20:14:47.200 -> LISTENING
   ```
   El sistema descarta automáticamente ese prefijo de tiempo y solo interpreta el contenido real (`LISTENING`). No es necesario quitarlo manualmente.
8. Si pasan **10 segundos** sin recibir `RAW_CAPTURADO_POR_CABLE`, el VIPER pasa a estado **Error** y se muestra el motivo `No se recibió respuesta del dispositivo.`. Podés reintentar con el botón **Reintentar**.

## 3. Verificación (cómo comprobar que quedó ACTIVO, ver el código, verificar en base de datos)

- **En la interfaz**: en la tabla de VIPERs, la columna **Estado** debe mostrar la insignia verde **Activo**, y la columna **Código** debe mostrar **Sí**.
- **Ver el código capturado**: hacé clic en **Ver código** (disponible para cualquier VIPER que ya tenga un código guardado, sin importar su estado actual). Se abre un cuadro de solo lectura con el código RAW completo, tal cual fue recibido.
- **Verificar en base de datos**: la tabla `vipers` tiene las columnas `estado` (`PENDIENTE`, `VALIDANDO`, `ACTIVO`, `ERROR`), `codigo_raw` (texto completo sin procesar), `baudrate`, `fecha_validacion`, `ultimo_test` y `ultimo_error`. Un VIPER activo y operativo tiene `estado = 'ACTIVO'` y `codigo_raw` no nulo.

## 4. Prueba de turnos (crear turno, seleccionar VIPER, llamar, verificar transmisión)

1. Iniciá sesión como **recepción** y entrá a la pantalla de **Recepción**.
2. En el formulario **Registrar Grupo**, completá el juego, el número de biper y, en el campo **Dispositivo VIPER**, elegí uno de los VIPERs listados. **Solo aparecen los VIPERs en estado `ACTIVO`** — los pendientes, en validación o con error no son seleccionables ahí.
3. Registrá el turno normalmente.
4. Como **operador** (o admin con permiso), llamá el turno desde la pantalla correspondiente.
5. Al llamar el turno:
   - Se activa el biper como siempre (sin cambios en esa lógica).
   - Si el turno tiene un VIPER asociado, el sistema busca su `codigo_raw` guardado y lo transmite por el puerto serial configurado.
   - **El número del VIPER nunca se envía al Arduino** — únicamente el código RAW completo (ej. `10364,204,752,196,752,...`), nunca un identificador corto como `4`.
6. Verificá la transmisión en el **Log Serial** (panel VIPER de Configuraciones): deberías ver `[SERIAL] RAW transmitido` y `[SERIAL] Transmisión exitosa`.

## 5. Solución de errores

| Síntoma | Causa probable | Solución |
|---|---|---|
| "El módulo serialport no está disponible en este servidor." | El servidor no tiene instalado o compilado el paquete `serialport` para esta plataforma/Node. | Reinstalar dependencias (`npm install`) en el equipo donde corre el servidor con el Arduino conectado. |
| "No hay un puerto COM configurado." | No se guardó ningún puerto en Configuración Serial. | Ir a Configuraciones → Configuración del Sistema, elegir el puerto y guardar. |
| Error al conectar (puerto no disponible / en uso) | El puerto está siendo usado por otro programa (ej. el Monitor Serial de Arduino IDE abierto al mismo tiempo). | Cerrar cualquier otro programa que tenga el puerto abierto antes de enviar una señal desde el sistema. |
| VIPER queda en "Error" con "No se recibió respuesta del dispositivo." | El Arduino no respondió en 10 segundos (cable desconectado, programa incorrecto cargado, baudios distintos). | Verificar el cableado, que el Arduino tenga cargado el sketch correcto y que los baudios configurados coincidan con los del sketch. Reintentar. |
| Dispositivo desconectado durante la prueba | El Arduino se desconectó físicamente o se reinició. | El log mostrará el cierre del puerto. Reconectar el Arduino y volver a intentar enviar la señal. |
| RAW no recibido pero "LISTENING" sí llegó | El Arduino quedó esperando la señal física (del cable/control) que nunca llegó. | Generar la señal física esperada (acercar el control, activar el cable, etc.) antes de que se cumpla el timeout de 10 segundos. |
| Arduino no responde nada (ni LISTENING) | El sketch no está corriendo, el cable USB no transmite datos, o el puerto elegido es incorrecto. | Confirmar el puerto correcto en el Administrador de dispositivos (Windows) o `ls /dev/tty*` (Linux/Mac), y que el sketch esté efectivamente cargado y corriendo. |

## 6. Guía completa para reproducir las pruebas con Arduino IDE y Serial Monitor

Esta sección es independiente del sistema web: sirve para simular o verificar manualmente el comportamiento del Arduino antes o durante la integración.

1. Instalá el **Arduino IDE** (https://www.arduino.cc/en/software) si no lo tenés.
2. Conectá el Arduino por USB y, en el IDE, seleccioná:
   - **Herramientas → Placa**: el modelo correspondiente a tu Arduino.
   - **Herramientas → Puerto**: el puerto COM (Windows) o `/dev/tty...` (Linux/Mac) donde aparece el Arduino.
3. Cargá en el Arduino un sketch que, a través de `Serial.begin(115200);`, escriba por el puerto serial los mensajes esperados por el sistema. Como referencia mínima de prueba, el sketch debe:
   - Al recibir un mensaje (por ejemplo `READY_PARA_TEST_DE_CABLE`), responder `LISTENING`.
   - Cuando detecte la señal física esperada (por ejemplo, lectura de un pin o de un cable), responder con una sola línea: `RAW_CAPTURADO_POR_CABLE:` seguido del código capturado, sin espacios extra y terminando con salto de línea (`Serial.println(...)`).
4. Para verificar el comportamiento sin pasar por el sistema web:
   - Abrí **Herramientas → Monitor Serie** (Serial Monitor) en el Arduino IDE.
   - Configurá la velocidad del Monitor Serie en **115200 baudios** (debe coincidir exactamente con `Serial.begin(...)` del sketch y con la configuración guardada en el sistema).
   - Escribí el mensaje (ej. `READY_PARA_TEST_DE_CABLE`) en el campo de envío del Monitor Serie y presioná Enter.
   - Deberías ver aparecer `LISTENING` en la consola, con el formato propio del IDE (con timestamp si está activada esa opción, ej. `20:14:47.200 -> LISTENING`).
   - Generá la señal física esperada por tu hardware (cable, control, sensor, etc.).
   - Deberías ver una línea `RAW_CAPTURADO_POR_CABLE:<código>` con el código completo.
5. **Importante**: mientras el Monitor Serie del Arduino IDE esté abierto, el sistema web **no podrá** abrir el mismo puerto (un puerto serial solo admite una conexión a la vez). Cerrá el Monitor Serie antes de usar el botón **Enviar señal** desde Configuraciones del Sistema.
6. Una vez verificado manualmente que el sketch responde correctamente, repetí la prueba completa desde la interfaz web (sección 2 de esta guía) para confirmar la integración de punta a punta.
