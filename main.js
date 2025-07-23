const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const SteamReader = require('./steam-reader');

console.log('Main process démarré !');

let mainWindow;
let steamReader;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
    steamReader = new SteamReader('TA_CLE_API_STEAM_ICI');
    console.log(' Chemin Steam détecté:', steamReader.steamPath);

    try {
        const testSteamId64 = '76561198006409530';
        const userInfo = await steamReader.fetchSteamUserInfo(testSteamId64);
        console.log('Test API Steam user info:', userInfo);
    } catch (err) {
        console.error('Erreur test API Steam:', err);
    }

    createWindow();
});

function ensureSteamReader() {
    if (!steamReader) {
        throw new Error('SteamReader non initialisé');
    }
}

ipcMain.handle('get-steam-path', async () => {
    try {
        ensureSteamReader();
        console.log(' get-steam-path appelé');
        return steamReader.steamPath;
    } catch (err) {
        console.error(err);
        return null;
    }
});

ipcMain.handle('get-steam-users', async () => {
    try {
        ensureSteamReader();
        console.log(' get-steam-users appelé - VRAIES données');
        const users = await steamReader.getSteamUsers();
        console.log(`👥 ${users.length} utilisateurs trouvés`);
        return { users, consent: true };
    } catch (err) {
        console.error(err);
        return { users: [], consent: false };
    }
});

ipcMain.handle('get-user-games', async (event, userId) => {
    try {
        ensureSteamReader();
        console.log(' get-user-games appelé pour:', userId);
        const games = await steamReader.getUserGames(userId);
        console.log(` ${games.length} jeux trouvés`);
        return games;
    } catch (err) {
        console.error(err);
        return [];
    }
});

ipcMain.handle('get-achievements', async (event, userId, gameId) => {
    try {
        ensureSteamReader();
        console.log(' get-achievements appelé:', userId, gameId);

        const achievements = await steamReader.getUserAchievements(userId, gameId);

        if (!achievements || achievements.length === 0) {
            console.log(' Pas de succès pour ce jeu');
            return {
                total: 0,
                unlocked: 0,
                percentage: 0,
                achievements: []
            };
        }

        console.log(`🏆 ${achievements.length} succès trouvés depuis l'API`);

        console.log('📊 Exemples de succès reçus:');
        achievements.slice(0, 3).forEach((ach, i) => {
            console.log(`  ${i+1}. ${ach.name || ach.apiname}:`);
            console.log(`     - achieved: ${ach.achieved} (type: ${typeof ach.achieved})`);
            console.log(`     - unlocktime: ${ach.unlocktime}`);
        });

        const formattedAchievements = achievements.map(ach => {
            const isAchieved = ach.achieved === 1 || ach.achieved === true || ach.achieved === "1";

            return {
                id: ach.apiname,
                name: ach.name || ach.apiname,
                description: ach.description || '',
                achieved: isAchieved,
                unlocked: isAchieved,
                unlockTime: ach.unlocktime || null,
                displayName: ach.name || ach.apiname,
                globalPercentage: 0
            };
        });

        const unlocked = formattedAchievements.filter(a => a.achieved).length;
        const total = formattedAchievements.length;
        const percentage = total > 0 ? Math.round((unlocked / total) * 100) : 0;

        console.log(` ${unlocked}/${total} succès débloqués (${percentage}%)`);

        return {
            total,
            unlocked,
            percentage,
            achievements: formattedAchievements
        };

    } catch (err) {
        console.error(' Erreur get-achievements:', err);
        return {
            total: 0,
            unlocked: 0,
            percentage: 0,
            achievements: []
        };
    }
});

ipcMain.handle('start-watching', async (event, userId, gameId) => {
    try {
        ensureSteamReader();
        console.log(' start-watching appelé:', userId, gameId);

        steamReader.watchAchievements(userId, gameId, (achievements) => {
            console.log(' Mise à jour des succès détectée !');

            if (!achievements || achievements.length === 0) {
                return;
            }

            const formattedAchievements = achievements.map(ach => ({
                id: ach.apiname,
                name: ach.name || ach.apiname,
                description: ach.description || '',
                achieved: ach.achieved === 1,
                unlocked: ach.achieved === 1,
                unlockTime: ach.unlocktime || null,
                displayName: ach.name || ach.apiname,
                globalPercentage: 0
            }));

            const unlocked = formattedAchievements.filter(a => a.achieved).length;
            const total = formattedAchievements.length;
            const percentage = total > 0 ? Math.round((unlocked / total) * 100) : 0;

            mainWindow.webContents.send('achievement-unlocked', {
                userId,
                gameId,
                total,
                unlocked,
                percentage,
                achievements: formattedAchievements
            });
        });

        return { success: true };
    } catch (err) {
        console.error(err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('fetch-steam-user-info', async (event, steamId64) => {
    try {
        ensureSteamReader();
        console.log('📞 fetch-steam-user-info appelé pour:', steamId64);
        if (!steamReader.apiKey) {
            return { error: 'Clé API Steam non définie' };
        }
        const userInfo = await steamReader.fetchSteamUserInfo(steamId64);
        return userInfo;
    } catch (err) {
        console.error('Erreur fetch-steam-user-info:', err);
        return { error: err.message };
    }
});

app.on('window-all-closed', () => {
    if (steamReader && steamReader.watchers) {
        if (steamReader.watchers instanceof Set) {
            steamReader.watchers.forEach(watcher => {
                if (typeof watcher === 'number') {
                    clearInterval(watcher);
                } else if (watcher.close) {
                    watcher.close();
                }
            });
            steamReader.watchers.clear();
        }
    }

    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});