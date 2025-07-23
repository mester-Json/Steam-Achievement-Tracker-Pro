const { ipcRenderer } = require('electron');

console.log('Preload simple chargé !');

window.steamAPI = {
    getSteamPath: () => {
        console.log('getSteamPath appelée');
        return ipcRenderer.invoke('get-steam-path');
    },

    getSteamUsers: () => {
        console.log('getSteamUsers appelée');
        return ipcRenderer.invoke('get-steam-users');
    },

    getUserGames: (userId) => {
        if (!userId) {
            console.warn('getUserGames appelée avec userId undefined ou null');
            return Promise.reject(new Error('userId est obligatoire'));
        }
        console.log('getUserGames appelée pour:', userId);
        return ipcRenderer.invoke('get-user-games', userId);
    },

    startWatching: (userId, gameId) => {
        console.log('startWatching appelée', userId, gameId);
        return ipcRenderer.invoke('start-watching', userId, gameId);
    },

    getAchievements: (userId, gameId) => {
        console.log('getAchievements appelée', userId, gameId);
        return ipcRenderer.invoke('get-achievements', userId, gameId);
    },

    onAchievementUnlocked: (callback) => {
        return ipcRenderer.on('achievement-unlocked', (event, data) => callback(data));
    }
};

console.log('steamAPI créée sur window !');

window.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM chargé, steamAPI disponible:', !!window.steamAPI);

    const statusEl = document.getElementById('status');
    const usersEl = document.getElementById('users');

    if (!statusEl || !usersEl) {
        console.error('Les éléments #status et/ou #users sont manquants dans le DOM.');
        return;
    }

    try {
        statusEl.textContent = 'Chargement des utilisateurs Steam...';

        const usersResult = await window.steamAPI.getSteamUsers();
        console.log('Utilisateurs Steam:', usersResult);

        if (!usersResult.users || usersResult.users.length === 0) {
            statusEl.textContent = " Aucun compte Steam détecté.";
            return;
        }

        statusEl.textContent = ` ${usersResult.users.length} compte(s) Steam détecté(s).`;

        usersEl.innerHTML = '';
        usersResult.users.forEach(steamId => {
            const div = document.createElement('div');
            div.textContent = `SteamID: ${steamId}`;
            div.style.cursor = 'pointer';
            div.style.padding = '5px';
            div.style.borderBottom = '1px solid #ccc';

            div.addEventListener('click', async () => {
                statusEl.textContent = `Chargement des jeux pour SteamID ${steamId}...`;
                try {
                    const games = await window.steamAPI.getUserGames(steamId);
                    console.log(`Jeux pour ${steamId}:`, games);
                    statusEl.textContent = `Jeux chargés pour SteamID ${steamId} (${games.length} jeux).`;
                } catch (err) {
                    console.error('Erreur getUserGames:', err);
                    statusEl.textContent = `Erreur lors du chargement des jeux pour ${steamId}`;
                }
            });

            usersEl.appendChild(div);
        });

    } catch (err) {
        console.error('Erreur lors de la récupération des utilisateurs Steam:', err);
        statusEl.textContent = 'Erreur lors du chargement des utilisateurs Steam.';
    }
});
