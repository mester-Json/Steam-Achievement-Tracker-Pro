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
            console.warn('️ Chemin Steam introuvable ! Certaines fonctionnalités ne fonctionneront pas.');
        }
        if (!this.apiKey) {
            console.warn('️ Clé API Steam non fournie. Certaines fonctionnalités ne fonctionneront pas.');
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
                console.warn(`️ Impossible de récupérer le nom de ${steamId}`);
            }

            users.push({ steamId, personaName });
        }

        return users;
    }

    async getUserGames(steamId64) {
        if (!this.apiKey) {
            console.warn('️ Clé API manquante, récupération locale uniquement');
            return this.getLocalGames();
        }

        try {
            console.log(`📥 Récupération de tous les jeux pour ${steamId64}...`);

            const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${this.apiKey}&steamid=${steamId64}&include_appinfo=true&include_played_free_games=true&format=json`;

            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`Erreur API: ${response.status}`);
                return this.getLocalGames();
            }

            const data = await response.json();

            if (!data.response || !data.response.games) {
                console.warn(' Pas de jeux trouvés ou profil privé');
                return this.getLocalGames();
            }

            const games = data.response.games.map(game => ({
                appid: game.appid.toString(),
                name: game.name,
                playtime: game.playtime_forever,
                playtime_2weeks: game.playtime_2weeks || 0,
                img_icon_url: game.img_icon_url,
                img_logo_url: game.img_logo_url,
                has_community_visible_stats: game.has_community_visible_stats,
                isInstalled: false
            }));

            console.log(` ${games.length} jeux trouvés via l'API`);

            // Marquer les jeux installés localement
            const localGames = this.getLocalGames();
            const localAppIds = new Set(localGames.map(g => g.appid));

            games.forEach(game => {
                if (localAppIds.has(game.appid)) {
                    game.isInstalled = true;
                }
            });

            games.sort((a, b) => {
                if (a.isInstalled !== b.isInstalled) {
                    return b.isInstalled - a.isInstalled;
                }
                return b.playtime - a.playtime;
            });

            return games;

        } catch (err) {
            console.error(' Erreur récupération jeux via API:', err.message);
            return this.getLocalGames();
        }
    }

    getLocalGames() {
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
                        games.push({
                            appid: appIdMatch[1],
                            name: nameMatch[1],
                            isInstalled: true
                        });
                    }
                }
            }
        }

        return games;
    }

    async getGlobalAchievementPercentages(appid) {
        try {
            const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}&format=json`;

            const response = await fetch(url);
            if (!response.ok) return null;

            const data = await response.json();

            if (data.achievementpercentages && data.achievementpercentages.achievements) {
                const percentages = {};
                data.achievementpercentages.achievements.forEach(ach => {
                    percentages[ach.name] = parseFloat(ach.percent);
                });
                return percentages;
            }

            return null;
        } catch (err) {
            console.error(' Erreur récupération pourcentages:', err);
            return null;
        }
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
            console.log('🌐 Appel API:', url.replace(this.apiKey, 'XXX'));

            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`️ Requête API Steam échouée : HTTP ${response.status}`);
                return null;
            }

            const data = await response.json();

            if (!data.playerstats) {
                console.warn('️ Pas de données playerstats dans la réponse API', data);
                return null;
            }

            if (data.playerstats.error) {
                console.warn('️ Erreur API Steam:', data.playerstats.error);
                return null;
            }

            const achievements = data.playerstats.achievements || [];

            if (achievements.length === 0) {
                console.info(`️ Aucun succès trouvé pour steamId=${steamId} appid=${appid}`);
            } else {
                console.log(` ${achievements.length} succès récupérés en français`);

                const [percentages, gameInfo, userStats] = await Promise.all([
                    this.getGlobalAchievementPercentages(appid),
                    this.getGameInfo(appid),
                    this.getUserGameStats(steamId, appid)
                ]);

                achievements.forEach(ach => {
                    if (percentages && percentages[ach.apiname]) {
                        ach.percentage = percentages[ach.apiname];
                    }

                    if (ach.achieved === 1 && ach.unlocktime) {
                        ach.legitimacy = this.checkAchievementLegitimacy(ach, userStats, gameInfo);
                    }
                });
            }

            return achievements;
        } catch (err) {
            console.error(' Erreur récupération succès:', err.message);
            return null;
        }
    }

    checkAchievementLegitimacy(achievement, userStats, gameInfo) {
        const legitimacy = {
            score: 100,
            issues: [],
            status: 'legitimate'
        };

        if (userStats && userStats.game_purchase_time && achievement.unlocktime < userStats.game_purchase_time) {
            legitimacy.score -= 100;
            legitimacy.issues.push('Débloqué avant l\'achat du jeu');
            legitimacy.status = 'cheated';
            return legitimacy;
        }

        if (userStats && userStats.playtime_at_unlock !== undefined && userStats.playtime_at_unlock === 0) {
            legitimacy.score -= 50;
            legitimacy.issues.push('Débloqué avec 0 minute de jeu');
        }

        if (userStats && userStats.achievements_timeline) {
            const unlockTime = achievement.unlocktime;
            const nearbyUnlocks = userStats.achievements_timeline.filter(time =>
                Math.abs(time - unlockTime) < 60
            );

            if (nearbyUnlocks.length > 10) {
                legitimacy.score -= 40;
                legitimacy.issues.push(`${nearbyUnlocks.length} succès débloqués en même temps`);
            } else if (nearbyUnlocks.length > 5) {
                legitimacy.score -= 20;
                legitimacy.issues.push(`${nearbyUnlocks.length} succès débloqués rapidement`);
            }
        }

        if (achievement.percentage && achievement.percentage < 0.1) {
            if (userStats && userStats.playtime_at_unlock < 60) { // Moins d'1h de jeu
                legitimacy.score -= 30;
                legitimacy.issues.push('Succès très rare débloqué trop tôt');
            }
        }

        const unlockSecond = achievement.unlocktime % 60;
        if (userStats && userStats.unlock_seconds_pattern) {
            const sameSecondCount = userStats.unlock_seconds_pattern[unlockSecond] || 0;
            if (sameSecondCount > 20) {
                legitimacy.score -= 50;
                legitimacy.issues.push('Pattern de déblocage suspect (même seconde)');
            }
        }

        if (legitimacy.score <= 0) {
            legitimacy.status = 'cheated';
            legitimacy.score = 0;
        } else if (legitimacy.score < 70) {
            legitimacy.status = 'suspicious';
        }

        return legitimacy;
    }
    async getUserGameStats(steamId, appid) {
        try {
            const [achievementsRes, ownedGamesRes] = await Promise.all([
                fetch(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${this.apiKey}&steamid=${steamId}&appid=${appid}`),
                fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${this.apiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true`)
            ]);

            if (!achievementsRes.ok || !ownedGamesRes.ok) return null;

            const [achievementsData, ownedGamesData] = await Promise.all([
                achievementsRes.json(),
                ownedGamesRes.json()
            ]);

            const playerAchievements = achievementsData?.playerstats?.achievements || [];
            const ownedGames = ownedGamesData?.response?.games || [];

            const targetGame = ownedGames.find(game => game.appid.toString() === appid.toString());
            const playtime_at_unlock = targetGame?.playtime_forever || 0;

            const unlockTimes = playerAchievements
                .filter(a => a.achieved === 1 && a.unlocktime)
                .map(a => a.unlocktime);

            const unlock_seconds_pattern = {};
            for (const ts of unlockTimes) {
                const second = ts % 60;
                unlock_seconds_pattern[second] = (unlock_seconds_pattern[second] || 0) + 1;
            }

            const game_purchase_time = unlockTimes.length ? unlockTimes[0] - 1800 : null;

            return {
                playtime_at_unlock,
                achievements_timeline: unlockTimes,
                unlock_seconds_pattern,
                game_purchase_time
            };

        } catch (err) {
            console.error('Erreur récupération des stats utilisateur:', err.message);
            return null;
        }
    }

    async getGameInfo(appid) {
        try {
            const url = `https://store.steampowered.com/api/appdetails?appids=${appid}`;
            const response = await fetch(url);

            if (!response.ok) return null;

            const data = await response.json();
            const gameData = data[appid];

            if (!gameData || !gameData.success) return null;

            return {
                name: gameData.data.name,
                release_date: gameData.data.release_date?.date,
                achievements_total: gameData.data.achievements?.total || 0
            };

        } catch (err) {
            console.error(' Erreur récupération infos jeu:', err);
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
            console.error('Erreur API Steam:', err.message);
            return null;
        }
    }

    async getGameStats(steamId, appid) {
        if (!this.apiKey) return null;

        try {
            const url = `https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v2/?key=${this.apiKey}&steamid=${steamId}&appid=${appid}`;

            const response = await fetch(url);
            if (!response.ok) return null;

            const data = await response.json();
            return data.playerstats || null;

        } catch (err) {
            console.error('Erreur récupération stats:', err);
            return null;
        }
    }
}



module.exports = SteamReader;