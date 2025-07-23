const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

class SteamReader {
    constructor(apiKey) {
        this.apiKey = apiKey || null;
        this.steamPath = this.findSteamPath();
        this.watchers = new Set();

        if (!this.steamPath) {
            console.warn(' Chemin Steam introuvable ! Certaines fonctionnalités ne fonctionneront pas.');
        }
        if (!this.apiKey) {
            console.warn(' Clé API Steam non fournie. Certaines fonctionnalités ne fonctionneront pas.');
        }
    }

    findSteamPath() {
        const platform = os.platform();
        if (platform === 'win32') {
            return this.findSteamPathWindows();
        } else if (platform === 'linux' || platform === 'darwin') {
            return null;
        }
        return null;
    }

    findSteamPathWindows() {
        try {
            const output = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', { encoding: 'utf8' });
            const match = output.match(/SteamPath\s+REG_SZ\s+(.+)/);
            if (match) {
                const steamPath = match[1].trim();
                const loginusersPath = path.join(steamPath, 'config', 'loginusers.vdf');
                if (fs.existsSync(loginusersPath)) {
                    return steamPath;
                }
            }
        } catch {
            console.warn('️ Impossible de lire SteamPath depuis le registre');
        }

        const fallbackPaths = [
            'C:/Program Files (x86)/Steam',
            'C:/Steam',
            'D:/Steam',
            'E:/Steam'
        ];

        for (const p of fallbackPaths) {
            const loginusersPath = path.join(p, 'config', 'loginusers.vdf');
            if (fs.existsSync(loginusersPath)) {
                return p;
            }
        }

        return null;
    }

    async getSteamUsers() {
        if (!this.steamPath) return [];

        const loginusersPath = path.join(this.steamPath, 'config', 'loginusers.vdf');
        if (!fs.existsSync(loginusersPath)) return [];

        const content = fs.readFileSync(loginusersPath, 'utf8');
        const steamIds = [...content.matchAll(/"(\d{17})"/g)].map(match => match[1]);

        const users = [];
        for (const steamId of steamIds) {
            let personaName = 'Utilisateur inconnu';
            try {
                const info = await this.fetchSteamUserInfo(steamId);
                if (info) personaName = info.personaname;
            } catch {
                console.warn(` Impossible de récupérer le nom de ${steamId}`);
            }

            users.push({ steamId, personaName });
        }

        return users;
    }

    getUserGames() {
        if (!this.steamPath) return [];

        const libraryfoldersPath = path.join(this.steamPath, 'steamapps', 'libraryfolders.vdf');
        if (!fs.existsSync(libraryfoldersPath)) return [];

        const libContent = fs.readFileSync(libraryfoldersPath, 'utf8');
        const libPaths = [];

        const matchesV2 = [...libContent.matchAll(/"\d+"\s*\{\s*"path"\s*"([^"]+)"/g)];
        if (matchesV2.length > 0) {
            for (const match of matchesV2) {
                libPaths.push(match[1]);
            }
        } else {
            const matchesV1 = [...libContent.matchAll(/"\d+"\s+"([^"]+)"/g)];
            for (const match of matchesV1) {
                libPaths.push(match[1]);
            }
        }

        const games = [];
        for (const libPath of libPaths) {
            const steamappsPath = path.join(libPath, 'steamapps');
            if (!fs.existsSync(steamappsPath)) continue;

            const files = fs.readdirSync(steamappsPath);
            for (const file of files) {
                if (file.startsWith('appmanifest_') && file.endsWith('.acf')) {
                    const manifestPath = path.join(steamappsPath, file);
                    const manifest = fs.readFileSync(manifestPath, 'utf8');

                    const appIdMatch = manifest.match(/"appid"\s+"(\d+)"/);
                    const nameMatch = manifest.match(/"name"\s+"([^"]+)"/);
                    if (appIdMatch && nameMatch) {
                        games.push({ appid: appIdMatch[1], name: nameMatch[1] });
                    }
                }
            }
        }

        return games;
    }

    async getUserAchievements(steamId, appid) {
        if (!this.apiKey) {
            console.warn(' Clé API Steam non définie');
            return null;
        }
        if (!steamId || !appid) {
            console.warn(' steamId ou appid manquant');
            return null;
        }

        try {
            const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${this.apiKey}&steamid=${steamId}&appid=${appid}&l=french`;
            console.log(' Appel API:', url.replace(this.apiKey, 'XXX'));

            const response = await fetch(url);
            if (!response.ok) {
                console.warn(` Requête API Steam échouée : HTTP ${response.status}`);
                return null;
            }

            const data = await response.json();

            if (!data.playerstats) {
                console.warn('️ Pas de données playerstats dans la réponse API', data);
                return null;
            }

            if (data.playerstats.error) {
                console.warn(' Erreur API Steam:', data.playerstats.error);
                return null;
            }

            const achievements = data.playerstats.achievements || [];

            if (achievements.length === 0) {
                console.info(` Aucun succès trouvé pour steamId=${steamId} appid=${appid}`);
            } else {
                console.log(` ${achievements.length} succès récupérés en français`);
            }

            return achievements;
        } catch (err) {
            console.error(' Erreur récupération succès:', err.message);
            return null;
        }
    }

    async getGameSchema(appid, language = 'french') {
        if (!this.apiKey) return null;

        try {
            const url = `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${this.apiKey}&appid=${appid}&l=${language}`;
            const response = await fetch(url);

            if (!response.ok) return null;

            const data = await response.json();

            if (data.game && data.game.availableGameStats && data.game.availableGameStats.achievements) {
                const achievementMap = {};
                data.game.availableGameStats.achievements.forEach(ach => {
                    achievementMap[ach.name] = {
                        displayName: ach.displayName,
                        description: ach.description,
                        icon: ach.icon,
                        icongray: ach.icongray
                    };
                });
                return achievementMap;
            }

            return null;
        } catch (err) {
            console.error(' Erreur récupération schéma:', err);
            return null;
        }
    }

    watchAchievements(steamId, appid, callback) {
        console.log(` Watching achievements for user ${steamId} game ${appid}`);

        const intervalId = setInterval(async () => {
            const achievements = await this.getUserAchievements(steamId, appid);
            callback(achievements);
        }, 60000);

        this.watchers.add(intervalId);

        return () => {
            clearInterval(intervalId);
            this.watchers.delete(intervalId);
        };
    }

    async fetchSteamUserInfo(steamId64) {
        if (!this.apiKey) throw new Error('Clé API Steam non définie');

        const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${this.apiKey}&steamids=${steamId64}`;

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

            const data = await response.json();
            return data.response.players[0] || null;
        } catch (err) {
            console.error(' Erreur API Steam:', err.message);
            return null;
        }
    }

    async fetchUserOwnedGames(steamId64) {
        if (!this.apiKey) throw new Error('Clé API manquante');

        const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${this.apiKey}&steamid=${steamId64}&include_appinfo=true&include_played_free_games=true`;

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            return data.response.games?.map(game => ({
                appid: game.appid,
                name: game.name
            })) || [];
        } catch (err) {
            console.error(' Impossible de récupérer les jeux via API:', err.message);
            return [];
        }
    }
}

/* test
if (require.main === module) {
    (async () => {
        const API_KEY = 'TA_CLE_API_STEAM_ICI';
        const steamIdTest = '76561197960435530';
        const appidTest = 440;

        const reader = new SteamReader(API_KEY);

        console.log('Steam Path détecté:', reader.steamPath);

        const achievements = await reader.getUserAchievements(steamIdTest, appidTest);
        if (!achievements) {
            console.log('Aucun succès trouvé ou erreur lors de la récupération.');
        } else if (achievements.length === 0) {
            console.log('Aucun succès débloqué pour ce joueur et ce jeu.');
        } else {
            console.log(`Succès (${achievements.length}) pour le jeu ${appidTest} :`);
            achievements.forEach(a => {
                console.log(` - ${a.apiname} : ${a.achieved ? 'Débloqué' : 'Non débloqué'}`);
                console.log(`   Nom: ${a.name}`);
                console.log(`   Description: ${a.description}`);
            });
        }
    })();
}
*/

module.exports = SteamReader;