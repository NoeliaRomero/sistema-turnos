# Sistema de Gestión de Turnos
## Manual de Usuario

---

|                    |                              |
|--------------------|------------------------------|
| **Versión**        | Demo                         |
| **Fecha**          | Julio 2025                   |
| **Destinatario**   | Personal operativo y administrativo |

---

```
┌─────────────────────────────────────────┐
│                                         │
│         [ ESPACIO PARA LOGO ]           │
│                                         │
└─────────────────────────────────────────┘
```

---

## Tabla de Contenidos

1. [Introducción](#1-introducción)
2. [Requisitos](#2-requisitos)
3. [Inicio de Sesión](#3-inicio-de-sesión)
4. [Roles y Perfiles de Usuario](#4-roles-y-perfiles-de-usuario)
5. [Pantalla de Recepción](#5-pantalla-de-recepción)
6. [Pantalla de Operador](#6-pantalla-de-operador)
7. [Pantalla Pública — Cola de Turnos](#7-pantalla-pública--cola-de-turnos)
8. [Panel de Administración](#8-panel-de-administración)
   - 8.1 [Estadísticas](#81-estadísticas)
   - 8.2 [Gestión de Usuarios](#82-gestión-de-usuarios)
   - 8.3 [Gestión de Juegos y Etapas](#83-gestión-de-juegos-y-etapas)
9. [Configuración del Sistema](#9-configuración-del-sistema)
10. [Dispositivos VIPER](#10-dispositivos-viper)
11. [Preguntas Frecuentes](#11-preguntas-frecuentes)
12. [Buenas Prácticas](#12-buenas-prácticas)
13. [Glosario](#13-glosario)

---

## 1. Introducción

El **Sistema de Gestión de Turnos** es una herramienta diseñada para organizar y controlar el flujo de grupos en parques de entretenimiento, complejos de juegos y actividades similares.

### ¿Para qué sirve?

Permite gestionar de forma ordenada cuándo y en qué orden cada grupo de personas ingresa a cada actividad o juego. En lugar de depender de listas en papel o de la memoria del personal, el sistema mantiene de forma automática y en tiempo real:

- Quién está esperando para cada juego
- Qué grupo está jugando en este momento
- Cuánto tiempo llevan jugando
- El orden en que deben ser llamados

### ¿Qué problemas resuelve?

| Problema habitual               | Solución del sistema                                    |
|---------------------------------|---------------------------------------------------------|
| Confusión en el orden de llegada| El sistema registra el orden automáticamente            |
| Grupos en el lugar equivocado   | Cada grupo tiene un biper y un juego asignado           |
| No saber cuánto tiempo llevaron | El sistema registra los tiempos de inicio y finalización|
| Errores de comunicación         | Toda la información es visible para todo el equipo      |
| Desconocimiento del estado      | Una pantalla pública muestra el estado en tiempo real   |

---

## 2. Requisitos

Para utilizar el sistema correctamente se necesita:

| Elemento            | Recomendación                                            |
|---------------------|----------------------------------------------------------|
| **Navegador**       | Google Chrome (versión reciente) · Microsoft Edge        |
| **Resolución**      | Mínimo 1280 × 720 píxeles                               |
| **Conexión**        | Internet estable o red local                            |
| **Dispositivo**     | PC, notebook o tablet (no se recomienda celular para administración) |

> **Nota:** El sistema funciona directamente desde el navegador. No es necesario instalar ningún programa adicional.

---

## 3. Inicio de Sesión

Al ingresar a la dirección del sistema en el navegador, se muestra la pantalla de inicio de sesión.

---

📷 **CAPTURA 01**
**Pantalla de Inicio de Sesión**
*(Debe verse el formulario de login con campos "Usuario" y "Contraseña", botón "Ingresar" y el indicador "Demo" en la esquina superior derecha)*

---

### Cómo ingresar

1. Escribí tu **nombre de usuario** en el primer campo
2. Escribí tu **contraseña** en el segundo campo
3. Hacé clic en el botón **Ingresar**

El sistema te redirige automáticamente a la pantalla que corresponde a tu rol.

### Credenciales de acceso — Versión Demo

En la versión de demostración, el acceso inicial es:

| Usuario | Contraseña | Rol         |
|---------|------------|-------------|
| `demo`  | `demo123`  | Administrador completo |

> **Importante:** El administrador puede crear usuarios adicionales con distintos roles y permisos desde el Panel de Administración.

---

## 4. Roles y Perfiles de Usuario

El sistema tiene tres tipos de usuarios, cada uno con acceso a distintas funciones:

| Rol              | Pantalla de acceso       | Funciones principales                                |
|------------------|--------------------------|------------------------------------------------------|
| **Administrador**| Panel de Administración  | Configuración completa, estadísticas, usuarios, juegos |
| **Operador**     | Pantalla de Operador     | Ver cola, llamar grupos, avanzar etapas, finalizar turnos |
| **Recepción**    | Pantalla de Recepción    | Registrar grupos, asignar bipers, ordenar la cola    |

> **Nota:** Los permisos de cada usuario pueden ajustarse individualmente. Un operador o recepcionista puede tener permisos adicionales o restringidos según lo configure el administrador.

---

## 5. Pantalla de Recepción

La pantalla de Recepción es donde se registran los grupos cuando llegan al parque. Desde aquí se gestiona la cola de espera de cada juego.

---

📷 **CAPTURA 02**
**Pantalla de Recepción — Vista general**
*(Debe verse el formulario de registro a la izquierda y las pestañas de cola por juego a la derecha, con grupos en espera)*

---

### 5.1 Registrar un nuevo grupo

Para anotar a un grupo que acaba de llegar:

1. **Seleccioná el juego** al que van a ingresar en el menú desplegable
2. **Número de biper:** el sistema sugiere automáticamente el próximo número disponible. Podés cambiarlo si es necesario
3. **Dispositivo VIPER** *(opcional):* si el grupo usa un dispositivo vibrador, seleccionalo de la lista. Solo aparecen los dispositivos activos y validados
4. **Nombre del grupo:** escribí el nombre de la familia o grupo (por ejemplo: *Familia García*)
5. **Cantidad de personas:** indicá cuántas personas componen el grupo con los botones **+** y **–**
6. Hacé clic en **Registrar grupo**

El grupo queda automáticamente en la cola de espera del juego seleccionado.

---

📷 **CAPTURA 03**
**Formulario de registro completado**
*(Debe verse el formulario con un juego seleccionado, número de biper completado, nombre del grupo y cantidad de personas)*

---

> **Consejo:** El sistema calcula automáticamente el **tiempo de espera estimado** según los grupos que ya están en cola. Este tiempo se muestra debajo del selector de juego.

> **Advertencia:** Si la cantidad de personas supera el máximo permitido por el juego, el sistema mostrará una advertencia. El personal puede decidir si procede igualmente o ajusta la cantidad.

### 5.2 Ver la cola de espera

La parte derecha de la pantalla muestra la cola de cada juego organizada en pestañas. Cada pestaña indica el nombre del juego y cuántos grupos están esperando.

---

📷 **CAPTURA 04**
**Cola de espera con varios grupos**
*(Debe verse la lista de grupos en espera con nombre, número de biper, cantidad de personas y botones de acción)*

---

Para cada grupo en espera se muestra:

- **Número de biper** (en recuadro azul oscuro)
- **Nombre del grupo**
- **Cantidad de personas**
- **Posición en la cola**
- **Botones:** Subir, Bajar, Llamar (si tiene permiso)

### 5.3 Cambiar el orden de la cola

Si necesitás priorizar un grupo o moverlo más atrás en la lista:

- Usá el botón **▲ (flecha arriba)** para mover el grupo una posición hacia adelante
- Usá el botón **▼ (flecha abajo)** para mover el grupo una posición hacia atrás

El cambio se refleja de inmediato en todas las pantallas del sistema.

> **Nota:** El botón de subir se desactiva para el primer grupo (ya está primero). El de bajar se desactiva para el último.

### 5.4 Llamar un grupo desde Recepción

Si el personal de recepción tiene permiso para llamar, verá el botón **Llamar** junto a cada grupo en espera.

Solo se puede llamar al **primer grupo de la cola**. Si hay otro grupo jugando, el sistema pedirá confirmación antes de llamar.

---

📷 **CAPTURA 05**
**Confirmación para llamar cuando ya hay un grupo jugando**
*(Debe verse el modal de confirmación indicando el grupo que está jugando y preguntando si se desea llamar igualmente)*

---

### 5.5 Ver grupos en juego

La sección superior de cada pestaña muestra los grupos que están **actualmente jugando**. Para cada uno se indica:

- Nombre del grupo y número de biper
- Tiempo transcurrido desde que fueron llamados
- Etapa actual (si el juego usa etapas)
- Botón para **finalizar** el turno (si tiene permiso)

---

📷 **CAPTURA 06**
**Grupo actualmente en juego**
*(Debe verse la tarjeta de un grupo llamado con el tiempo transcurrido y la etapa actual)*

---

### 5.6 Finalizar un turno desde Recepción

Para marcar que un grupo terminó:

1. Hacé clic en el botón **Finalizar** junto al grupo
2. El sistema pedirá confirmación
3. Al confirmar, el grupo se elimina de la pantalla y el siguiente grupo en cola queda listo para ser llamado

### 5.7 Notificación del próximo turno

Cuando un grupo finaliza, aparece automáticamente en la parte inferior de la pantalla un aviso con el **nombre y biper del próximo grupo en espera** para ese juego.

---

## 6. Pantalla de Operador

La pantalla de Operador está diseñada para el personal que se encuentra junto al juego. Permite llamar grupos, avanzar entre etapas y finalizar turnos.

---

📷 **CAPTURA 07**
**Pantalla de Operador — Vista general**
*(Debe verse el selector de atracción arriba y las tarjetas de grupos en cola y en juego)*

---

### 6.1 Seleccionar la atracción

Al ingresar, el operador puede ver todos los juegos activos. Si tiene un juego asignado, la pantalla lo muestra por defecto.

Usá el selector desplegable para filtrar por juego.

### 6.2 Ver la cola

La pantalla muestra dos secciones:

- **En juego:** grupos actualmente jugando
- **En espera:** grupos que esperan ser llamados, en orden de cola

Cada tarjeta muestra el número de biper, el nombre del grupo, la cantidad de personas y la etapa actual.

---

📷 **CAPTURA 08**
**Grupos en espera y grupo en juego con etapas**
*(Debe verse una tarjeta de grupo en juego con etapa actual y próxima etapa, y debajo la lista de grupos en espera)*

---

### 6.3 Llamar un grupo

Para llamar al próximo grupo de la cola:

1. Hacé clic en el botón **Llamar** que aparece junto al primer grupo en espera
2. El sistema cambia el estado del grupo a "en juego"
3. Si el grupo tiene un dispositivo VIPER asignado, se envía automáticamente la señal de vibración

> **Importante:** Solo se puede llamar al primer grupo de la cola. Si intentás llamar a un grupo que no es el primero, el botón aparece desactivado.

### 6.4 Avanzar etapas

Si el juego está configurado con etapas (por ejemplo: *Briefing → Carrera → Fotos*), el botón de finalizar muestra el nombre de la **próxima etapa** en lugar de "Finalizar".

---

📷 **CAPTURA 09**
**Botón de avance de etapa**
*(Debe verse el botón que dice "Avanzar a [nombre de la próxima etapa]" dentro de la tarjeta del grupo en juego)*

---

Al hacer clic en ese botón:

- El grupo avanza a la siguiente etapa
- El nombre de la etapa actual se actualiza en la tarjeta
- Se registra el tiempo de inicio de la nueva etapa

Cuando se llega a la última etapa, el botón muestra **Finalizar**.

### 6.5 Finalizar un turno

Cuando el grupo termina de jugar:

1. Hacé clic en el botón **Finalizar**
2. El turno queda registrado como completado
3. El próximo grupo en cola queda disponible para ser llamado

### 6.6 Cancelar un turno

Si un grupo no se presentó o ya no desea participar, podés cancelar su turno haciendo clic en el botón **Cancelar** (ícono de papelera roja). El sistema pedirá confirmación antes de eliminar el turno.

> **Nota:** Esta acción requiere que el operador tenga el permiso de cancelación habilitado.

### 6.7 Tiempos

El sistema muestra el tiempo transcurrido desde que el grupo fue llamado. Esto ayuda al operador a saber cuándo un turno está próximo a vencer.

---

## 7. Pantalla Pública — Cola de Turnos

La pantalla pública es una vista especial diseñada para proyectarse en un televisor o monitor visible para los clientes que esperan. No requiere inicio de sesión.

---

📷 **CAPTURA 10**
**Pantalla pública de cola**
*(Debe verse la pantalla oscura con fondo azul marino, el reloj, las tarjetas de grupos por juego y los bipers resaltados)*

---

### ¿Qué muestra?

- **Reloj en tiempo real**
- **Por cada juego:** el grupo actualmente en juego y los grupos en espera
- **Biper de cada grupo** resaltado en forma destacada
- **Barra de progreso** del tiempo restante del turno actual

### Filtros por juego

En la parte superior hay botones para filtrar la vista por juego. Se puede mostrar todos los juegos a la vez o solo uno en particular.

### Actualización automática

La pantalla se actualiza automáticamente cada vez que hay un cambio: nuevo grupo registrado, grupo llamado, etapa avanzada o turno finalizado. No es necesario recargar el navegador.

---

## 8. Panel de Administración

El Panel de Administración está reservado para el rol **Administrador**. Desde aquí se controla toda la configuración del sistema.

Al ingresar se ven tres pestañas principales:

| Pestaña         | Función                                                  |
|-----------------|----------------------------------------------------------|
| **Estadísticas**| Gráficos y resúmenes de actividad                        |
| **Usuarios**    | Crear, editar y eliminar usuarios del sistema            |
| **Juegos**      | Crear, editar y eliminar juegos y sus etapas             |

---

📷 **CAPTURA 11**
**Panel de Administración — Vista general con pestañas**
*(Debe verse la barra superior "Administración", las tres pestañas y el contenido de Estadísticas activo)*

---

### 8.1 Estadísticas

La pestaña de Estadísticas muestra información sobre el uso del sistema. Se puede filtrar por período:

| Filtro    | Qué muestra                            |
|-----------|----------------------------------------|
| **Hoy**   | Actividad del día actual               |
| **7 días**| Actividad de los últimos 7 días        |
| **30 días**| Actividad del último mes              |
| **Todo**  | Toda la historia disponible            |

#### Indicadores principales

- **Total de turnos:** cantidad de grupos que pasaron por el sistema
- **Finalizados:** turnos completados correctamente
- **En espera:** grupos que están actualmente esperando
- **Tiempo promedio de espera:** cuánto tarda en promedio un grupo desde que se registra hasta que es llamado

---

📷 **CAPTURA 12**
**Tarjetas de indicadores en Estadísticas**
*(Debe verse la fila de cuatro tarjetas con los valores: Total, Finalizados, En espera, Tiempo promedio)*

---

#### Gráficos disponibles

**Turnos por atracción:** gráfico de dona que muestra cuántos turnos correspondieron a cada juego.

---

📷 **CAPTURA 13**
**Gráfico de dona — Turnos por atracción**
*(Debe verse el gráfico circular dividido por colores, uno por juego, con su leyenda)*

---

**Evolución por día:** gráfico de línea que muestra cuántos turnos hubo cada día dentro del período seleccionado.

---

📷 **CAPTURA 14**
**Gráfico de línea — Evolución por día**
*(Debe verse la curva de turnos a lo largo de los días con el área sombreada debajo)*

---

**Actividad por hora:** gráfico de barras que indica en qué horarios del día hay más movimiento. La barra del horario pico se resalta en amarillo.

---

📷 **CAPTURA 15**
**Gráfico de barras — Actividad por hora**
*(Debe verse el gráfico con 24 columnas horarias, la de mayor actividad en color amarillo)*

---

**Actividad por operador:** gráfico de barras dobles que compara cuántos turnos llamó y cuántos finalizó cada operador.

---

📷 **CAPTURA 16**
**Gráfico de operadores — Llamados vs Finalizados**
*(Debe verse el gráfico con dos barras por operador: azul para llamados, verde para finalizados)*

---

#### Tabla de operadores

Debajo de los gráficos aparece una tabla con el detalle por operador:

| Columna                | Significado                                                  |
|------------------------|--------------------------------------------------------------|
| Nombre                 | Nombre del operador                                          |
| Atracción              | Juego asignado                                               |
| Turnos llamados        | Cantidad de grupos que llamó                                 |
| Turnos finalizados     | Cantidad de grupos que finalizó                              |
| Tiempo promedio        | Duración promedio de los turnos que atendió                  |

---

📷 **CAPTURA 17**
**Tabla de resumen por operador**
*(Debe verse la tabla con columnas Nombre, Atracción, Llamados, Finalizados, Tiempo promedio)*

---

### 8.2 Gestión de Usuarios

Desde la pestaña **Usuarios** podés ver, crear, editar y eliminar las cuentas de acceso al sistema.

---

📷 **CAPTURA 18**
**Lista de usuarios**
*(Debe verse la tabla con columnas: Nombre, Usuario, Rol, Atracción asignada, Permisos, Estado activo/inactivo, botones Editar y Eliminar)*

---

#### Crear un usuario nuevo

1. Hacé clic en el botón **+ Nuevo usuario**
2. Completá el formulario:

| Campo               | Descripción                                                        |
|---------------------|--------------------------------------------------------------------|
| **Nombre completo** | Nombre visible del usuario                                         |
| **Usuario**         | Nombre con el que ingresará al sistema (sin espacios)              |
| **Contraseña**      | Clave de acceso (mínimo recomendado: 6 caracteres)                 |
| **Rol**             | Administrador, Operador o Recepción                                |
| **Atracción**       | Solo para operadores: juego al que está asignado                   |
| **Permisos extras** | Llamar turnos, cancelar turnos, gestionar juegos (según el rol)    |

3. Hacé clic en **Guardar**

---

📷 **CAPTURA 19**
**Formulario de nuevo usuario**
*(Debe verse el modal con los campos nombre, usuario, contraseña, rol, atracción y permisos)*

---

#### Editar un usuario

1. Hacé clic en el ícono de **lápiz** junto al usuario
2. Modificá los campos necesarios
3. Si no querés cambiar la contraseña, dejá ese campo vacío
4. Hacé clic en **Guardar**

#### Eliminar un usuario

1. Hacé clic en el ícono de **papelera** junto al usuario
2. El sistema mostrará una confirmación con el nombre del usuario
3. Hacé clic en **Eliminar** para confirmar

> **Importante:** Esta acción es irreversible. El usuario no podrá volver a ingresar al sistema. El historial de sus acciones se conserva.

> **Restricciones:**
> - No se puede eliminar el usuario con el que estás conectado actualmente
> - No se puede eliminar el usuario `demo`

---

📷 **CAPTURA 20**
**Modal de confirmación para eliminar usuario**
*(Debe verse el modal con el nombre del usuario, la advertencia de irreversibilidad y los botones Cancelar y Eliminar)*

---

#### Roles y permisos disponibles

| Permiso                | Administrador | Operador | Recepción |
|------------------------|:-------------:|:--------:|:---------:|
| Ver estadísticas       | ✅            | ❌       | ❌        |
| Gestionar usuarios     | ✅            | ❌       | ❌        |
| Gestionar juegos       | ✅ (siempre)  | ⚙️ Opcional | ⚙️ Opcional |
| Llamar turnos          | ✅            | ✅       | ⚙️ Opcional |
| Cancelar turnos        | ✅            | ⚙️ Opcional | ⚙️ Opcional |

*⚙️ Opcional: habilitado o no según lo configure el administrador*

---

### 8.3 Gestión de Juegos y Etapas

Desde la pestaña **Juegos** se crean y administran las atracciones disponibles en el parque.

---

📷 **CAPTURA 21**
**Lista de juegos**
*(Debe verse la tabla con juegos, duración, rango de personas, estado activo/inactivo y botones Editar y Eliminar)*

---

#### Crear un juego nuevo

1. Hacé clic en **+ Nuevo juego**
2. Completá el formulario:

| Campo                     | Descripción                                                           |
|---------------------------|-----------------------------------------------------------------------|
| **Nombre**                | Nombre del juego (ej: *Karting*, *Escape Room*)                       |
| **¿Usa etapas?**          | Activar si el juego se divide en fases (ver sección de Etapas)        |
| **Duración (minutos)**    | Solo si no usa etapas. Tiempo total de la actividad                   |
| **Mín. personas**         | Cantidad mínima para que el grupo pueda ingresar                      |
| **Máx. personas**         | Límite máximo de personas por turno                                   |

3. Hacé clic en **Guardar**

---

📷 **CAPTURA 22**
**Formulario de nuevo juego — Sin etapas**
*(Debe verse el modal con nombre, duración en minutos y rango de personas)*

---

📷 **CAPTURA 23**
**Formulario de nuevo juego — Con etapas activadas**
*(Debe verse el modal con la sección de etapas expandida, una etapa cargada con nombre y duración)*

---

#### Editar un juego

1. Hacé clic en el ícono de **lápiz** junto al juego
2. Modificá los campos que necesites
3. Hacé clic en **Guardar**

> **Nota:** También podés activar o desactivar un juego desde aquí. Un juego inactivo no aparece en los formularios de registro de turnos.

#### Eliminar un juego

1. Hacé clic en el ícono de **papelera** junto al juego
2. El sistema mostrará una confirmación con el nombre del juego
3. Hacé clic en **Eliminar** para confirmar

> **Advertencia:** No se puede eliminar un juego que tenga grupos actualmente **en espera o jugando**. Primero debés finalizar o cancelar esos turnos.

> **Importante:** Esta acción elimina el juego y todo su historial de turnos. Es irreversible.

---

📷 **CAPTURA 24**
**Modal de confirmación para eliminar juego**
*(Debe verse el modal con el nombre del juego, la advertencia de irreversibilidad y los botones Cancelar y Eliminar)*

---

#### Etapas

Las etapas son fases dentro de un juego. Por ejemplo, un juego de Karting puede tener: *Briefing de seguridad → Carrera → Fotos en el podio*.

Cuando un juego usa etapas:
- Su duración total se calcula automáticamente sumando la duración de cada etapa
- El operador avanza al grupo de una etapa a la siguiente en lugar de finalizar directamente

**Para agregar etapas al crear o editar un juego:**

1. Activá la opción **¿Usa etapas?**
2. Hacé clic en **Agregar etapa**
3. Escribí el nombre de la etapa y su duración en minutos
4. Repetí para cada etapa
5. Usá las flechas ↑ ↓ para reordenarlas
6. Usá el ícono de papelera para eliminar una etapa

---

📷 **CAPTURA 25**
**Sección de etapas dentro del formulario de juego**
*(Debe verse la lista de etapas con nombre, duración, flechas de orden y botón de eliminar por etapa, y la duración total calculada al pie)*

---

> **Consejo:** La duración total del juego se actualiza automáticamente al agregar, modificar o eliminar etapas. No es necesario calcularla manualmente.

---

## 9. Configuración del Sistema

La pantalla de Configuración permite conectar y administrar los dispositivos físicos **VIPER** que se usan para vibrar los bipers de los clientes.

---

📷 **CAPTURA 26**
**Pantalla de Configuración del Sistema**
*(Debe verse la pantalla con el panel de conexión serial, selector de puerto COM, selector de velocidad y el log de actividad)*

---

### Conexión serial

Para que los dispositivos VIPER funcionen, el sistema debe conectarse al receptor serial (dispositivo físico que transmite las señales):

1. Seleccioná el **Puerto COM** donde está conectado el receptor
2. Seleccioná la **velocidad** (baudios) — consultar con el proveedor del equipo
3. Hacé clic en **Guardar configuración**

> **Nota:** Si no hay dispositivos VIPER o no se utilizan, esta configuración puede ignorarse. Los turnos funcionan igual sin la señal física.

### Log de actividad

La parte inferior de la pantalla muestra un registro en tiempo real de las señales enviadas a los dispositivos. Es útil para verificar que el equipo está funcionando correctamente.

---

## 10. Dispositivos VIPER

Los dispositivos VIPER son los bipers físicos que vibran cuando se llama a un grupo. Cada VIPER tiene un código único y un estado.

La administración de VIPERs está disponible desde la pantalla de **Configuración**.

---

📷 **CAPTURA 27**
**Lista de dispositivos VIPER**
*(Debe verse la tabla con código VIPER, estado (ACTIVO/PENDIENTE/ERROR), fecha de validación y botones de editar y eliminar)*

---

### Estados de un VIPER

| Estado       | Significado                                                     |
|--------------|-----------------------------------------------------------------|
| **PENDIENTE**| Registrado pero aún no validado con el equipo físico            |
| **ACTIVO**   | Validado y disponible para asignar a grupos                     |
| **ERROR**    | Falló la última comunicación con el dispositivo físico          |

Solo los VIPER en estado **ACTIVO** aparecen disponibles al registrar un nuevo grupo en Recepción.

### Registrar un VIPER nuevo

1. Hacé clic en **Agregar VIPER**
2. Ingresá el código identificador del dispositivo (ej: *V-001*)
3. Hacé clic en **Guardar**

El VIPER queda registrado en estado **PENDIENTE**. Para activarlo, es necesario validarlo con el hardware físico.

### Activar un VIPER

Una vez conectado el receptor serial, hacé clic en el botón **Activar** junto al VIPER. El sistema intentará comunicarse con el dispositivo y, si responde correctamente, cambia su estado a **ACTIVO**.

### Editar un VIPER

1. Hacé clic en el ícono de **lápiz** junto al VIPER
2. Podés modificar el código, el canal de radio y el estado
3. Hacé clic en **Guardar**

### Eliminar un VIPER

1. Hacé clic en el ícono de **papelera** junto al VIPER
2. Confirmá la eliminación

> **Nota:** Si el VIPER está asignado a un turno activo, no se eliminará hasta que ese turno finalice.

---

📷 **CAPTURA 28**
**Formulario de edición de VIPER**
*(Debe verse el modal con código VIPER, estado y configuración de canal)*

---

---

## 11. Preguntas Frecuentes

### ¿Por qué no puedo llamar a un grupo que no es el primero?

El sistema exige respetar el orden de la cola. Solo se puede llamar al grupo que está en la primera posición. Si necesitás cambiar el orden, usá los botones ▲ y ▼ en la pantalla de Recepción.

---

### El sistema me avisa que el VIPER está en otro juego, ¿qué hago?

Esto ocurre cuando el número de biper asignado ya está jugando en otro juego al mismo tiempo. El sistema avisa para evitar confusiones. Podés:

- Esperar a que ese turno finalice en el otro juego
- Proceder igualmente si estás seguro de que es un error (el sistema lo permite con confirmación)

---

### ¿Qué pasa si llamo a un grupo que supera la capacidad máxima?

El sistema avisa con una advertencia indicando la cantidad actual y el límite del juego. Podés confirmar igualmente o cancelar para ajustar la cantidad de personas.

---

### ¿Cómo cambio la contraseña de un usuario?

Desde el Panel de Administración → Usuarios:

1. Hacé clic en el ícono de lápiz del usuario
2. Escribí la nueva contraseña en el campo correspondiente
3. Guardá los cambios

Si dejás el campo de contraseña vacío, la contraseña actual **no se modifica**.

---

### El grupo terminó de jugar pero el turno sigue apareciendo como activo

Posiblemente el operador no finalizó el turno desde su pantalla. Desde Recepción o desde el Panel de Operador podés finalizarlo manualmente haciendo clic en el botón **Finalizar**.

---

### ¿Se pueden ver los turnos de días anteriores?

Sí. Las estadísticas del Panel de Administración muestran el historial de turnos por período: hoy, 7 días, 30 días o todo el historial disponible.

---

### Un juego no aparece en el formulario de registro

Los juegos inactivos no aparecen disponibles en el formulario de Recepción. Verificá desde el Panel de Administración → Juegos que el juego esté marcado como **Activo**.

---

### ¿Puedo eliminar un juego que tiene turnos activos?

No. Si un juego tiene grupos en espera o jugando, el sistema bloqueará la eliminación y mostrará un mensaje explicando el motivo. Primero debés finalizar o cancelar todos los turnos activos de ese juego.

---

## 12. Buenas Prácticas

Seguir estas recomendaciones ayuda a que el sistema funcione de forma ordenada y sin inconvenientes:

---

**✅ Registrar los grupos apenas llegan**

No esperar a último momento. Cuanto antes se registra un grupo, más preciso es el orden de la cola y el tiempo de espera estimado.

---

**✅ Finalizar cada turno cuando el grupo termina**

Es importante marcar el turno como finalizado en el momento en que el grupo termina. Esto libera el lugar para el próximo grupo y mantiene las estadísticas precisas.

---

**✅ Utilizar los nombres de los grupos**

Ingresar siempre un nombre identificatorio (Familia García, Grupo de empresa, etc.). Facilita la comunicación entre recepción y los operadores.

---

**✅ Usar el orden de la cola solo cuando sea realmente necesario**

Mover grupos arriba o abajo puede generar confusión si se hace frecuentemente. Reservar esta función para casos donde haya una razón justificada (accesibilidad, prioridad médica, etc.).

---

**✅ Verificar que el operador correcto esté asignado al juego correcto**

Si un operador está en el panel equivocado puede ver y afectar la cola del juego incorrecto.

---

**⚠️ No cerrar la sesión en equipos compartidos sin cerrarla correctamente**

Usar el botón **Salir** al terminar el turno de trabajo. Esto evita que otra persona use la sesión sin autorización.

---

**⚠️ No eliminar usuarios que estén en uso**

Verificar que el usuario a eliminar no sea la misma persona que está conectada. El sistema lo impedirá, pero es buena práctica verificarlo antes.

---

## 13. Glosario

| Término           | Significado                                                                                                   |
|-------------------|---------------------------------------------------------------------------------------------------------------|
| **Turno**         | El registro de un grupo en el sistema. Incluye el juego al que va, el biper asignado, cuántas personas son y en qué estado están (esperando, jugando o finalizado). |
| **Biper**         | Número identificador que se le entrega al cliente cuando llega. Puede corresponder a un biper físico de vibración (VIPER) o simplemente a un número en pantalla. |
| **VIPER**         | Dispositivo físico de vibración que se entrega al cliente. Cuando su número es llamado, el dispositivo vibra para avisarle que es su turno. |
| **Juego**         | Actividad o atracción disponible en el parque. Puede ser Karting, Escape Room, Laser Tag, etc. Cada juego tiene su propia cola. |
| **Etapa**         | Fase dentro de un juego. Por ejemplo, el Karting puede tener etapas: Briefing → Carrera → Fotos. El operador avanza de una etapa a la siguiente durante el turno. |
| **Cola**          | Lista ordenada de grupos que esperan para ingresar a un juego. El primero de la cola es el siguiente en ser llamado. |
| **Administrador** | Usuario con acceso completo al sistema. Puede crear y eliminar usuarios, juegos y configuraciones.             |
| **Operador**      | Usuario que trabaja junto al juego. Llama a los grupos, avanza etapas y finaliza turnos.                      |
| **Recepción**     | Usuario que registra los grupos cuando llegan al parque. Gestiona la cola de espera.                          |
| **Llamar**        | Acción de indicar que un grupo debe pasar a jugar. Cambia el estado del turno de "esperando" a "en juego".    |
| **Finalizar**     | Acción de indicar que un grupo terminó de jugar. El turno queda registrado como completado.                   |
| **Cancelar**      | Acción de eliminar un turno sin que el grupo haya jugado (cliente que no llegó, desistió, etc.).              |
| **Estado activo** | Un juego o usuario está activo cuando está habilitado para ser usado. Un juego inactivo no aparece en la cola.|

---

*Fin del Manual de Usuario*

---

> Este documento fue generado para la versión **Demo** del Sistema de Gestión de Turnos.
> Para consultas o soporte, contactar al administrador del sistema.
