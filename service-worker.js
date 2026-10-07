function broadcastReminder(matches) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab?.id) {
            return;
        }

        chrome.tabs.sendMessage(activeTab.id, {
            action: "show_lineup_reminder",
            matches,
            reminderMinutes: matches[0]?.reminderMinutes || 60
        }).catch(() => {});
    });
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
        const parsed = new Date(candidate.endsWith("Z") || candidate.includes("+") || candidate.includes("-") ? candidate : `${candidate}Z`);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.getTime();
        }
    }

    return Number.NaN;
}

async function scheduleTeamReminder(team) {
    try {
        const response = await fetch(
            `https://www.thesportsdb.com/api/v1/json/123/eventsnext.php?id=${encodeURIComponent(team.id)}`
        );
        if (!response.ok) {
            return;
        }

        const data = await response.json();
        const events = Array.isArray(data.events)
            ? data.events
            : Array.isArray(data.results)
                ? data.results
                : [];
        const match = events.find((event) => event.dateEvent);
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
            await chrome.storage.local.set({
                [alarmName]: {
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
        }
    } catch (error) {
        console.error("Could not schedule lineup reminder:", error);
    }
}

let schedulingTeams = Promise.resolve();

async function scheduleSavedTeams() {
    schedulingTeams = schedulingTeams.then(async () => {
        const { savedTeams = [] } = await chrome.storage.local.get("savedTeams");

        for (const team of savedTeams) {
            await scheduleTeamReminder(team);
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    });

    await schedulingTeams;
}

chrome.runtime.onStartup.addListener(scheduleSavedTeams);
chrome.runtime.onInstalled.addListener(scheduleSavedTeams);
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.savedTeams) {
        scheduleSavedTeams();
    }
});

scheduleSavedTeams();

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith("lineup-reminder:")) {
        return;
    }

    const saved = await chrome.storage.local.get(alarm.name);
    const match = saved[alarm.name];
    if (!match) {
        return;
    }

    broadcastReminder([match]);
    await chrome.storage.local.remove(alarm.name);
});
