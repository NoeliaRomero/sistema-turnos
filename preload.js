'use strict';

/**
 * preload.js — Puente de contexto (contextBridge) entre el renderer sandboxeado
 * y el proceso principal de Electron.
 *
 * Expone únicamente dos funciones sin argumentos que invocan diálogos nativos
 * del sistema operativo (selección de carpeta / archivo). No se expone ninguna
 * otra API de Node ni de Electron al renderer: contextIsolation y sandbox
 * permanecen intactos (ver main.js).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Abre un diálogo nativo de selección de carpeta (destino de backups).
  // Devuelve la ruta absoluta elegida, o null si el usuario cancela.
  elegirCarpetaBackup: () => ipcRenderer.invoke('backup:elegir-carpeta'),

  // Abre un diálogo nativo de selección de archivo .zip (restaurar backup).
  // Devuelve la ruta absoluta elegida, o null si el usuario cancela.
  elegirArchivoRestaurar: () => ipcRenderer.invoke('backup:elegir-archivo'),
});
