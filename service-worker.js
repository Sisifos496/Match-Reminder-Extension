async function broadcastReminder(matches) {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab?.id) {
        return false;
    }

    try {
        await chrome.tabs.sendMessage(activeTab.id, {
            action: "show_lineup_reminder",
            matches,
            reminderMinutes: matches[0]?.reminderMinutes || 60
        });
        return true;
    } catch (error) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                files: ["data.js"]
            });
            await chrome.tabs.sendMessage(activeTab.id, {
                action: "show_lineup_reminder",
                matches,
                reminderMinutes: matches[0]?.reminderMinutes || 60
            });
            console.info("Injected the reminder popup into the active tab after its content script was missing.");
            return true;
        } catch (injectionError) {
            console.info("Could not show reminder popup in the active tab:", injectionError.message || error.message);
            return false;
        }
    }
}

function getReminderKey(match) {
    const homeTeam = (match.homeTeam || "").trim().toLowerCase();
    const awayTeam = (match.awayTeam || "").trim().toLowerCase();
    const eventId = match.eventId || match.fixtureId || "";
    if (homeTeam && awayTeam && match.reminderTime) {
        return `teams:${homeTeam}:${awayTeam}:${match.reminderTime}:${match.reminderMinutes || 60}`;
    }

    return `ids:${eventId}:${match.reminderMinutes || 60}`;
}

function deduplicateReminders(matches) {
    return [...new Map(matches.map((match) => [getReminderKey(match), match])).values()];
}

function parseApiDateValue(dateEvent, strTime, strTimestamp) {
    const candidates = [];

    if (strTimestamp) {
        candidates.push(strTimestamp.trim());
    }

    if (dateEvent) {
        const timeValue = (strTime || "00:00:00").trim() || "00:00:00";
        candidates.push(`${dateEvent}T${timeValue}`);
        candidates.push(`${dateEvent}T00:00:00`);
    }

    for (const candidate of candidates) {
        const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(candidate);
        const parsed = new Date(hasTimezone ? candidate : `${candidate}Z`);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.getTime();
        }
    }

    return Number.NaN;
}

const matchRefreshIntervalMs = 8 * 60 * 60 * 1000;
const matchRefreshJitterMs = 60 * 60 * 1000;
const matchRefreshRetryMs = 30 * 60 * 1000;
const initialTeamCheckDelayMs = 60 * 1000;
const initialTeamCheckJitterMs = 9 * 60 * 1000;
const matchRefreshes = new Map();

function getMatchCacheKey(teamId) {
    return `upcomingMatch:${teamId}`;
}

function getMatchRefreshAlarmName(teamId) {
    return `upcoming-match-cache:${teamId}`;
}

function getMatchRefreshJitter(cache) {
    return Number.isFinite(cache?.refreshJitterMs)
        ? cache.refreshJitterMs
        : Math.floor(Math.random() * matchRefreshJitterMs);
}

function getNextMatchRefreshTime(checkedAt, jitter) {
    return checkedAt + matchRefreshIntervalMs + jitter;
}

async function scheduleInitialTeamMatchCheck(team) {
    const alarmName = getMatchRefreshAlarmName(team.id);
    if (await chrome.alarms.get(alarmName)) {
        return;
    }

    const delay = initialTeamCheckDelayMs + Math.floor(Math.random() * initialTeamCheckJitterMs);
    await chrome.alarms.create(alarmName, { when: Date.now() + delay });
    console.info(`Scheduled the first match check for ${team.name} in about ${Math.ceil(delay / 60000)} minute(s).`);
}

function findUpcomingMatch(events, team) {
    const now = Date.now();
    const match = events
        .map((event) => ({
            event,
            matchTime: parseApiDateValue(event.dateEvent, event.strTime, event.strTimestamp)
        }))
        .filter(({ event, matchTime }) =>
            event.dateEvent &&
            (event.idEvent || event.idAPIfootball) &&
            !Number.isNaN(matchTime) &&
            matchTime > now
        )
        .sort((first, second) => first.matchTime - second.matchTime)[0]?.event;

    if (!match) {
        const eventDiagnostics = events.map((event) => {
            const eventTime = parseApiDateValue(event.dateEvent, event.strTime, event.strTimestamp);
            return {
                eventId: event.idEvent || event.idAPIfootball || null,
                dateEvent: event.dateEvent || null,
                strTime: event.strTime || null,
                strTimestamp: event.strTimestamp || null,
                parsedTime: Number.isNaN(eventTime) ? "invalid" : new Date(eventTime).toISOString(),
                isFuture: !Number.isNaN(eventTime) && eventTime > now
            };
        });
        console.info(`No upcoming match found for ${team.name}. Checked events:`, eventDiagnostics);
    }

    return match || null;
}

async function clearTeamReminderAlarms(team) {
    const [alarms, stored] = await Promise.all([
        chrome.alarms.getAll(),
        chrome.storage.local.get(null)
    ]);
    const teamName = (team.name || "").trim().toLowerCase();

    for (const alarm of alarms) {
        if (!alarm.name.startsWith("lineup-reminder:")) {
            continue;
        }

        const reminder = stored[alarm.name] || {};
        const reminderTeamIds = Array.isArray(reminder.teamIds)
            ? reminder.teamIds.map(String)
            : reminder.teamId
                ? [String(reminder.teamId)]
                : [];
        if (reminderTeamIds.length > 0) {
            const remainingTeamIds = reminderTeamIds.filter((teamId) => teamId !== String(team.id));
            if (remainingTeamIds.length === reminderTeamIds.length) {
                continue;
            }

            if (remainingTeamIds.length > 0) {
                await chrome.storage.local.set({
                    [alarm.name]: {
                        ...reminder,
                        teamId: remainingTeamIds[0],
                        teamIds: remainingTeamIds
                    }
                });
                continue;
            }

            await chrome.alarms.clear(alarm.name);
            await chrome.storage.local.remove(alarm.name);
            continue;
        }

        const belongsToTeam = [reminder.homeTeam, reminder.awayTeam]
            .some((name) => (name || "").trim().toLowerCase() === teamName);
        if (belongsToTeam) {
            await chrome.alarms.clear(alarm.name);
            await chrome.storage.local.remove(alarm.name);
        }
    }
}

async function scheduleTeamReminderAlarms(team, cache, replace = false) {
    if (replace) {
        await clearTeamReminderAlarms(team);
    }

    const match = cache?.match;
    if (!match) {
        return;
    }

    const matchTime = parseApiDateValue(match.dateEvent, match.strTime, match.strTimestamp);
    const matchId = match.idEvent || match.idAPIfootball;
    if (!matchId || Number.isNaN(matchTime)) {
        return;
    }

    for (const reminderMinutes of [60, 10]) {
        const reminderTime = matchTime - reminderMinutes * 60 * 1000;
        if (reminderTime <= Date.now()) {
            continue;
        }

        const alarmName = `lineup-reminder:${matchId}:${reminderMinutes}`;
        const existing = await chrome.storage.local.get(alarmName);
        const existingReminder = existing[alarmName] || {};
        const existingTeamIds = Array.isArray(existingReminder.teamIds)
            ? existingReminder.teamIds.map(String)
            : existingReminder.teamId
                ? [String(existingReminder.teamId)]
                : [];
        const teamIds = [...new Set([...existingTeamIds, String(team.id)])];
        await chrome.storage.local.set({
            [alarmName]: {
                teamId: teamIds[0],
                teamIds,
                fixtureId: match.idAPIfootball || "",
                eventId: match.idEvent || "",
                homeTeam: match.strHomeTeam || "Home team",
                awayTeam: match.strAwayTeam || "Away team",
                reminderMinutes,
                reminderHour: Math.floor(reminderTime / 3600000),
                reminderTime
            }
        });
        await chrome.alarms.create(alarmName, { when: reminderTime });
        console.info(`Scheduled ${reminderMinutes}-minute reminder for ${team.name}: ${match.strHomeTeam} vs ${match.strAwayTeam}.`);
    }
}

async function loadTeamMatchCache(team) {
    const cacheKey = getMatchCacheKey(team.id);
    const stored = await chrome.storage.local.get(cacheKey);
    let cache = stored[cacheKey];
    if (!cache || Number.isFinite(cache.nextCheckAt)) {
        return cache || null;
    }

    if (cache.match) {
        const matchTime = parseApiDateValue(cache.match.dateEvent, cache.match.strTime, cache.match.strTimestamp);
        if (Number.isNaN(matchTime) || matchTime <= Date.now()) {
            return null;
        }
    }

    const checkedAt = Date.now();
    const jitter = getMatchRefreshJitter(cache);
    cache = {
        match: cache.match || null,
        status: cache.match ? "match" : "no-match",
        checkedAt,
        nextCheckAt: getNextMatchRefreshTime(checkedAt, jitter),
        refreshJitterMs: jitter
    };
    await chrome.storage.local.set({ [cacheKey]: cache });
    await chrome.alarms.create(getMatchRefreshAlarmName(team.id), { when: cache.nextCheckAt });
    await scheduleTeamReminderAlarms(team, cache);
    return cache;
}

async function fetchAndCacheTeamMatch(team, previousCache) {
    const checkedAt = Date.now();
    const jitter = getMatchRefreshJitter(previousCache);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(
            `https://www.thesportsdb.com/api/v1/json/123/eventsnext.php?id=${encodeURIComponent(team.id)}`,
            { signal: controller.signal }
        );
        if (!response.ok) {
            throw new Error(`TheSportsDB returned ${response.status}.`);
        }

        const data = await response.json();
        if (!data || typeof data !== "object" ||
            (!Array.isArray(data.events) && data.events !== null &&
                !Array.isArray(data.results) && data.results !== null)) {
            throw new Error("TheSportsDB returned an invalid events response.");
        }
        const events = Array.isArray(data.events)
            ? data.events
            : Array.isArray(data.results)
                ? data.results
                : [];
        const match = findUpcomingMatch(events, team);
        const cache = {
            match,
            status: match ? "match" : "no-match",
            checkedAt,
            nextCheckAt: getNextMatchRefreshTime(checkedAt, jitter),
            refreshJitterMs: jitter
        };

        await chrome.storage.local.set({ [getMatchCacheKey(team.id)]: cache });
        await chrome.alarms.create(getMatchRefreshAlarmName(team.id), { when: cache.nextCheckAt });
        await scheduleTeamReminderAlarms(team, cache, true);
        return { ok: true, cache };
    } catch (error) {
        const cache = {
            match: previousCache?.match || null,
            status: "error",
            checkedAt,
            nextCheckAt: checkedAt + matchRefreshRetryMs,
            refreshJitterMs: jitter,
            error: error.message
        };
        await chrome.storage.local.set({ [getMatchCacheKey(team.id)]: cache });
        await chrome.alarms.create(getMatchRefreshAlarmName(team.id), { when: cache.nextCheckAt });
        console.error(`Could not refresh matches for ${team.name}:`, error);
        return { ok: false, cache, error: "The match service could not be reached. It will retry in 30 minutes." };
    } finally {
        clearTimeout(timeout);
    }
}

async function refreshTeamMatch(team, previousCache) {
    const teamId = String(team.id);
    if (matchRefreshes.has(teamId)) {
        return matchRefreshes.get(teamId);
    }

    const refresh = fetchAndCacheTeamMatch(team, previousCache);
    matchRefreshes.set(teamId, refresh);
    try {
        return await refresh;
    } finally {
        matchRefreshes.delete(teamId);
    }
}

async function getUpcomingMatchForTeam(teamId) {
    const { savedTeams = [] } = await chrome.storage.local.get("savedTeams");
    const team = savedTeams.find((savedTeam) => String(savedTeam.id) === String(teamId));
    if (!team) {
        return { ok: false, error: "This team is no longer saved." };
    }

    const cache = await loadTeamMatchCache(team);
    if (cache?.nextCheckAt > Date.now()) {
        return cache.status === "error"
            ? { ok: false, cache, error: cache.error }
            : { ok: true, cache };
    }

    return refreshTeamMatch(team, cache);
}

async function restoreSavedTeamSchedules() {
    const { savedTeams = [] } = await chrome.storage.local.get("savedTeams");
    for (const team of savedTeams) {
        const cache = await loadTeamMatchCache(team);
        if (!cache) {
            await scheduleInitialTeamMatchCheck(team);
            continue;
        }

        await chrome.alarms.create(getMatchRefreshAlarmName(team.id), {
            when: Math.max(cache.nextCheckAt, Date.now() + 1000)
        });
        await scheduleTeamReminderAlarms(team, cache);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== "get_upcoming_match") {
        return;
    }

    getUpcomingMatchForTeam(request.teamId).then(sendResponse, (error) => {
        console.error("Could not load saved team match:", error);
        sendResponse({ ok: false, error: "Could not load matches right now." });
    });
    return true;
});

chrome.runtime.onStartup.addListener(restoreSavedTeamSchedules);
chrome.runtime.onInstalled.addListener(restoreSavedTeamSchedules);
async function handleSavedTeamsChange(changes) {
    const previousTeams = changes.savedTeams.oldValue || [];
    const currentTeams = changes.savedTeams.newValue || [];
    for (const team of previousTeams) {
        if (currentTeams.some((currentTeam) => String(currentTeam.id) === String(team.id))) {
            continue;
        }

        await chrome.alarms.clear(getMatchRefreshAlarmName(team.id));
        await chrome.storage.local.remove(getMatchCacheKey(team.id));
        await clearTeamReminderAlarms(team);
    }

    await restoreSavedTeamSchedules();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.savedTeams) {
        return;
    }

    handleSavedTeamsChange(changes).catch((error) => {
        console.error("Could not restore saved team schedules:", error);
    });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith("upcoming-match-cache:")) {
        const teamId = alarm.name.slice("upcoming-match-cache:".length);
        const { savedTeams = [] } = await chrome.storage.local.get("savedTeams");
        const team = savedTeams.find((savedTeam) => String(savedTeam.id) === teamId);
        if (!team) {
            await chrome.storage.local.remove(getMatchCacheKey(teamId));
            await chrome.alarms.clear(alarm.name);
            return;
        }

        const cache = await loadTeamMatchCache(team);
        if (cache?.nextCheckAt > Date.now()) {
            await chrome.alarms.create(alarm.name, { when: cache.nextCheckAt });
            return;
        }

        await refreshTeamMatch(team, cache);
        return;
    }

    if (!alarm.name.startsWith("lineup-reminder:")) {
        return;
    }

    const saved = await chrome.storage.local.get(alarm.name);
    const match = saved[alarm.name];
    if (!match) {
        return;
    }

    await broadcastReminder([match]);
    await chrome.storage.local.remove(alarm.name);
});
