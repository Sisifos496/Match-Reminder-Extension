const params = new URLSearchParams(window.location.search);
const fixtureId = params.get("fixture");
const homeTeam = params.get("home") || "Home team";
const awayTeam = params.get("away") || "Away team";
const status = document.getElementById("status");
const lineupsContainer = document.getElementById("lineups");
const cacheKey = `lineup:${fixtureId}`;
const reminderPopup = document.getElementById("reminder-popup");

document.title = `${homeTeam} vs ${awayTeam} Lineup`;
document.getElementById("match-title").textContent = `${homeTeam} vs ${awayTeam}`;

function showStatus(message) {
    status.textContent = message;
}

function playReminderSound() {
    try {
        const audioContext = new AudioContext();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.frequency.value = 740;
        oscillator.type = "sine";
        gain.gain.setValueAtTime(0.08, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.35);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.35);
    } catch (error) {
        console.debug("Reminder sound was blocked by the browser.");
    }
}

function showReminderPopup(reminderHome = homeTeam, reminderAway = awayTeam) {
    const reminderMessage = document.getElementById("reminder-message");
    if (reminderMessage) {
        reminderMessage.textContent = `Lineups are announced for ${reminderHome} vs ${reminderAway}.`;
    }

    if (reminderPopup) {
        reminderPopup.hidden = false;
    }
    playReminderSound();
}

document.getElementById("close-reminder").addEventListener("click", () => {
    reminderPopup.hidden = true;
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.action !== "show_lineup_reminder") {
        return;
    }

    const reminder = (message.matches || []).find((match) => {
        return match.fixtureId === fixtureId || match.eventId === params.get("event");
    });
    if (reminder) {
        showReminderPopup(reminder.homeTeam, reminder.awayTeam);
    }
});

async function showPendingReminder() {
    const stored = await chrome.storage.local.get(null);
    const pendingEntry = Object.entries(stored).find(([key, value]) => {
        if (!key.startsWith("lineup-reminder-pending:") || !value) {
            return false;
        }
        return value.fixtureId === fixtureId || value.eventId === params.get("event");
    });

    if (pendingEntry) {
        showReminderPopup(pendingEntry[1].homeTeam, pendingEntry[1].awayTeam);
        await chrome.storage.local.remove(pendingEntry[0]);
    }
}

const demoMode = params.get("demo") === "1";

function createDemoLineup(teamName) {
    return {
        team: { name: teamName },
        formation: "4-3-3",
        startXI: Array.from({ length: 11 }, (_, index) => ({
            player: { name: `${teamName} Player ${index + 1}`, pos: "MID" },
            number: index + 1
        })),
        substitutes: Array.from({ length: 5 }, (_, index) => ({
            player: { name: `${teamName} Substitute ${index + 1}`, pos: "SUB" },
            number: index + 12
        }))
    };
}

function renderPlayers(list, players, role) {
    players.forEach((entry) => {
        const player = entry.player || {};
        const item = document.createElement("li");
        item.className = "player";
        item.textContent = player.name || "Unknown player";

        if (entry.number || player.pos) {
            const details = document.createElement("span");
            details.className = "role";
            details.textContent = [entry.number, player.pos || role].filter(Boolean).join(" ");
            item.appendChild(details);
        }

        list.appendChild(item);
    });
}

function createPlayerGroup(title, players, role) {
    const group = document.createElement("div");
    group.className = "player-group";

    const heading = document.createElement("h3");
    heading.textContent = title;
    group.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "players";
    renderPlayers(list, players, role);
    group.appendChild(list);
    return group;
}

function renderLineups(lineups) {
    lineupsContainer.innerHTML = "";

    if (!lineups || lineups.length === 0) {
        showStatus("Lineup is not available yet.");
        return;
    }

    showStatus("");
    lineups.forEach((lineup) => {
        const section = document.createElement("section");
        section.className = "lineup";

        const heading = document.createElement("h2");
        heading.textContent = lineup.team?.name || "Team lineup";
        section.appendChild(heading);

        if (lineup.formation) {
            const formation = document.createElement("div");
            formation.className = "formation";
            formation.textContent = `Formation: ${lineup.formation}`;
            section.appendChild(formation);
        }

        section.appendChild(createPlayerGroup("Starting XI", lineup.startXI || [], "Starter"));
        section.appendChild(createPlayerGroup("Substitutes", lineup.substitutes || [], "Substitute"));
        lineupsContainer.appendChild(section);
    });
}

async function loadLineup() {
    if (demoMode) {
        renderLineups([createDemoLineup(homeTeam), createDemoLineup(awayTeam)]);
        return;
    }

    if (!fixtureId) {
        showStatus("This match does not have an API-Football fixture ID.");
        return;
    }

    const cached = await chrome.storage.local.get(cacheKey);
    if (cached[cacheKey]) {
        renderLineups(cached[cacheKey]);
        return;
    }

    if (!window.API_FOOTBALL_KEY) {
        showStatus("Add your API-Football key in api-config.js to load lineups.");
        return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch(
            `https://v3.football.api-sports.io/fixtures/lineups?fixture=${encodeURIComponent(fixtureId)}`,
            {
                headers: { "x-apisports-key": window.API_FOOTBALL_KEY },
                signal: controller.signal
            }
        );

        if (!response.ok) {
            throw new Error(`API-Football returned ${response.status}`);
        }

        const data = await response.json();
        const lineups = data.response || [];
        await chrome.storage.local.set({ [cacheKey]: lineups });
        renderLineups(lineups);
    } catch (error) {
        console.error("Error fetching lineup:", error);
        showStatus(error.name === "AbortError" ? "Lineup request timed out." : "Could not load the lineup.");
    } finally {
        clearTimeout(timeout);
    }
}

showPendingReminder();
loadLineup();
