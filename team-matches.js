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
        const parsed = new Date(normalized.includes("Z") || normalized.includes("+") || normalized.includes("-") ? normalized : `${normalized}Z`);
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
        timeStyle: "short"
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
    matchItem.tabIndex = 0;

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
    const openDetails = () => {
        const params = new URLSearchParams({
            fixture: match.idAPIfootball || "",
            event: match.idEvent || "",
            home: match.strHomeTeam || "Unknown",
            away: match.strAwayTeam || "Unknown"
        });
        window.location.href = `event-details.html?${params}`;
    };
    matchItem.addEventListener("click", openDetails);
    matchItem.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openDetails();
        }
    });
    element.appendChild(matchItem);
}

function getUtcDateString(date) {
    return date.toISOString().slice(0, 10);
}

async function fetchJsonWithRetry(url, signal) {
    let attempt = 0;

    while (attempt <= 2) {
        const response = await fetch(url, { signal });
        if (response.status !== 429 || attempt === 2) {
            return response;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        attempt += 1;
    }
}

async function loadMatches() {
    if (!teamId) {
        showMessage(upcomingMatches, "Team information is missing.", "error-state");
        return;
    }

    showMessage(upcomingMatches, "Loading...", "loading-state");

    try {
        const teamResponse = await fetchJsonWithRetry(
            `https://www.thesportsdb.com/api/v1/json/123/lookupteam.php?id=${encodeURIComponent(teamId)}`
        );
        const upcomingResponse = await fetchJsonWithRetry(
            `https://www.thesportsdb.com/api/v1/json/123/eventsnext.php?id=${encodeURIComponent(teamId)}`
        );

        if (!teamResponse.ok || !upcomingResponse.ok) {
            const error = new Error("TheSportsDB request failed");
            error.rateLimited = teamResponse.status === 429 || upcomingResponse.status === 429;
            throw error;
        }

        const [teamData, upcomingData] = await Promise.all([
            teamResponse.json(),
            upcomingResponse.json()
        ]);

        const team = teamData.teams?.[0];
        if (!team || team.strSport !== "Soccer") {
            showMessage(upcomingMatches, "This saved team ID is not a soccer team. Remove it and save the team again.", "error-state");
            return;
        }

        const upcomingEvents = Array.isArray(upcomingData.events)
            ? upcomingData.events
            : Array.isArray(upcomingData.results)
                ? upcomingData.results
                : [];
        const now = new Date();
        const upcoming = upcomingEvents
            .filter((event) => event.dateEvent)
            .filter((event) => getMatchDate(event) > now)
            .sort((a, b) => getMatchDate(a) - getMatchDate(b));

        renderMatch(upcomingMatches, upcoming[0]);
    } catch (error) {
        console.error("Error fetching team matches:", error);
        showMessage(
            upcomingMatches,
            error.rateLimited
                ? "The match service is temporarily rate-limited. Please wait a moment and try again."
                : "Could not load matches.",
            "error-state"
        );
    }
}

loadMatches();
