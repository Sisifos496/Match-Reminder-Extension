const params = new URLSearchParams(window.location.search);
const teamId = params.get("id");
const teamName = params.get("name") || "Team Matches";
const teamLogo = params.get("logo");
const upcomingMatches = document.getElementById("upcoming-matches");

document.title = `${teamName} Matches`;
document.getElementById("team-name").textContent = teamName;

if (teamLogo) {
    const logoElement = document.getElementById("team-logo");
    logoElement.src = `${teamLogo}/preview`;
    logoElement.alt = `${teamName} logo`;
} else {
    const logoElement = document.getElementById("team-logo");
    logoElement.remove();
}

function showMessage(element, message, className) {
    element.innerHTML = "";
    const messageItem = document.createElement("li");
    messageItem.className = className;
    messageItem.textContent = message;
    element.appendChild(messageItem);
}

function getMatchDate(event) {
    const rawTimestamp = event.strTimestamp;
    const dateEvent = event.dateEvent;
    const timeValue = event.strTime || "00:00:00";
    const candidates = [];

    if (rawTimestamp) {
        candidates.push(rawTimestamp.trim());
    }

    if (dateEvent) {
        candidates.push(`${dateEvent}T${timeValue}`);
        candidates.push(`${dateEvent}T00:00:00`);
    }

    for (const candidate of candidates) {
        const normalized = candidate.includes("T") ? candidate : `${candidate}T00:00:00`;
        const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
        const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }

    return new Date(NaN);
}

function formatMatchDate(event) {
    const date = getMatchDate(event);
    if (Number.isNaN(date.getTime())) {
        return "Date unavailable";
    }

    return date.toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Istanbul"
    });
}

function renderMatch(element, match) {
    element.innerHTML = "";
    if (!match) {
        showMessage(element, "No upcoming matches found.", "empty-state");
        return;
    }

    const matchItem = document.createElement("li");
    matchItem.className = "match-item";

    const date = document.createElement("div");
    date.className = "match-date";
    date.textContent = formatMatchDate(match);

    const teams = document.createElement("div");
    teams.className = "match-teams";
    teams.textContent = `${match.strHomeTeam || "Unknown"} vs ${match.strAwayTeam || "Unknown"}`;

    const league = document.createElement("div");
    league.className = "match-league";
    league.textContent = match.strLeague || "Competition unavailable";

    matchItem.append(date, teams, league);
    element.appendChild(matchItem);
}

async function loadMatches() {
    if (!teamId) {
        showMessage(upcomingMatches, "Team information is missing.", "error-state");
        return;
    }

    showMessage(upcomingMatches, "Loading...", "loading-state");

    try {
        const result = await chrome.runtime.sendMessage({
            action: "get_upcoming_match",
            teamId
        });
        const cachedMatch = result?.cache?.match;
        if (!result?.ok) {
            if (cachedMatch && getMatchDate(cachedMatch) > new Date()) {
                renderMatch(upcomingMatches, cachedMatch);
            } else {
                showMessage(upcomingMatches, result?.error || "Could not load matches.", "error-state");
            }
            return;
        }

        renderMatch(
            upcomingMatches,
            cachedMatch && getMatchDate(cachedMatch) > new Date() ? cachedMatch : null
        );
    } catch (error) {
        console.error("Error fetching team matches:", error);
        showMessage(upcomingMatches, "Could not load matches.", "error-state");
    }
}

loadMatches();
