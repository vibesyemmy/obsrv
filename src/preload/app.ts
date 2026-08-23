import { contextBridge } from 'electron'
contextBridge.exposeInMainWorld('obsrv', { version: '0.1.0' })
