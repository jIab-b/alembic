const {contextBridge}=require('electron');
contextBridge.exposeInMainWorld('alembicDesktop',Object.freeze({platform:process.platform}));
