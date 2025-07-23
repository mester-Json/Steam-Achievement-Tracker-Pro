const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script chargé !');

try {
    contextBridge.exposeInMainWorld('steamAPI', {
        getSteamPath: () => {
            console.log('getSteamPath appelée');
            return ipcRenderer.invoke('get-steam-path');
        },
        
        getSteamUsers: () => {
            console.log('getSteamUsers appelée');
            return ipcRenderer.invoke('get-steam-users');
        },
        
        startWatching: (userId, gameId) => {
            console.log('startWatching appelée', userId, gameId);
            return ipcRenderer.invoke('start-watching', userId, gameId);
        },

        getUserGames: (userId) => ipcRenderer.invoke('get-user-games', userId),

        getAchievements: (userId, gameId) => {
            console.log('getAchievements appelée', userId, gameId);
            return ipcRenderer.invoke('get-achievements', userId, gameId);
        },
        
        onAchievementUnlocked: (callback) => {
            return ipcRenderer.on('achievement-unlocked', (event, data) => callback(data));
        }
    });
    
    console.log('contextBridge.exposeInMainWorld terminé avec succès');
    
} catch (error) {
    console.error('Erreur dans contextBridge:', error);
}

console.log('Test immédiat steamAPI:', typeof window.steamAPI);

window.addEventListener('DOMContentLoaded', () => {
    console.log('DOM chargé, steamAPI disponible:', !!window.steamAPI);
    console.log('Type de steamAPI:', typeof window.steamAPI);
    
    if (window.steamAPI) {
        console.log('Méthodes disponibles:', Object.keys(window.steamAPI));
    }
});

setTimeout(() => {
    console.log('Test après délai - steamAPI:', !!window.steamAPI);
}, 100);