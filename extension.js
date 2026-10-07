let keyboardTimeout;
let resultsMessageTimeout;
let searchController;
let searchRequestId = 0;
const searchDelayMs = 500;
const apiRetryDelayMs = 1000;
const apiRetryCount = 2;
const knownTeamIds = {
    leeds: 133635,
    "leeds united": 133635
};

let inputArea = document.querySelector(".team-search-input");
const savedTeamsButton = document.getElementById("saved-teams-button");

async function fetchJson(url, signal) {
    let attempt = 0;

    while (attempt <= apiRetryCount) {
        const response = await fetch(url, { signal });
        if (response.status !== 429 || attempt === apiRetryCount) {
            return response;
        }

        await new Promise((resolve) => setTimeout(resolve, apiRetryDelayMs * 2 ** attempt));
        attempt += 1;
    }
}

async function fetchTeams(searchQuery, signal) {
    try {
        const response = await fetchJson(
            `https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=${encodeURIComponent(searchQuery)}`,
            signal
        );
        if (!response?.ok) {
            return null;
        }

        const body = await response.text();
        try {
            return JSON.parse(body);
        } catch (error) {
            console.warn(`TheSportsDB returned a non-JSON response for ${searchQuery}.`);
            return null;
        }
    } catch (error) {
        if (error.name !== "AbortError") {
            console.warn(`Team search failed for ${searchQuery}:`, error);
        }
        return null;
    }
}

async function fetchKnownTeam(searchQuery, signal) {
    const teamId = knownTeamIds[searchQuery.toLowerCase()];
    if (!teamId) {
        return null;
    }

    try {
        const response = await fetchJson(
            `https://www.thesportsdb.com/api/v1/json/123/lookupteam.php?id=${teamId}`,
            signal
        );
        if (!response?.ok) {
            return null;
        }

        return await response.json();
    } catch (error) {
        if (error.name !== "AbortError") {
            console.warn(`Known team lookup failed for ${searchQuery}:`, error);
        }
        return null;
    }
}

savedTeamsButton.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("saved-teams.html") });
});

inputArea.addEventListener("input", () => {
    clearTimeout(keyboardTimeout);
    clearTimeout(resultsMessageTimeout);
    searchController?.abort();

    keyboardTimeout = setTimeout(async () => {
        const query = inputArea.value.trim();
        if (query.length < 3) {
            resultsList.classList.add("hidden");
            resultsList.innerHTML = "";
            return;
        }

        const currentRequestId = ++searchRequestId;
        searchController = new AbortController();

        try {
            const primaryResult = await fetchTeams(query, searchController.signal);
            if (currentRequestId !== searchRequestId) {
                return;
            }

            const knownTeamResult = await fetchKnownTeam(query, searchController.signal);
            if (currentRequestId !== searchRequestId) {
                return;
            }

            const primaryTeams = primaryResult?.teams || [];
            const fallbackQuery = primaryTeams.some((team) => team.strGender === "Female")
                ? `${query} United`
                : `${query} Women`;
            const fallbackResult = knownTeamResult ? null : await fetchTeams(fallbackQuery, searchController.signal);
            if (currentRequestId !== searchRequestId) {
                return;
            }

            const searchResults = [primaryResult, fallbackResult, knownTeamResult];
            const successfulSearches = searchResults.filter((data) => data !== null);
            const teams = successfulSearches.flatMap((data) => data.teams || []);

            if (successfulSearches.length === 0) {
                resultsList.innerHTML = "<li style='color:#f59e0b;'>Search is temporarily rate-limited. Please wait a moment and try again.</li>";
                resultsList.classList.remove("hidden");
                return;
            }

            if (teams.length === 0) {
                resultsList.innerHTML = "<li style='color:#6b7280;'>No teams found</li>";
                resultsList.classList.remove("hidden");
                return;
            }

            const soccerTeams = teams
                .filter((team) => team.strSport === "Soccer")
                .filter((team, index, allTeams) => allTeams.findIndex((candidate) => candidate.idTeam === team.idTeam) === index)
                .map((team) => ({
                    id: team.idTeam,
                    name: team.strTeam,
                    logo: team.strBadge,
                    sport: team.strSport
                }));

            renderSearchResults(soccerTeams);
        } catch (error) {
            if (error.name === "AbortError" || currentRequestId !== searchRequestId) {
                return;
            }

            console.error("Error fetching from TheSportsDB:", error);
            resultsList.innerHTML = "<li style='color:#f59e0b;'>Search is temporarily rate-limited. Please wait a moment and try again.</li>";
            resultsList.classList.remove("hidden");
        }
    }, searchDelayMs);
});

let renderSearchResults = async (teams) => {
    resultsList.innerHTML = "";
    if (teams.length === 0) {
        resultsList.classList.add("hidden");
        return;
    }
    
    teams.forEach(team => {
        const li = document.createElement("li");
        li.className = "team-result";

        const logoUrl = team.logo ? `${team.logo}/preview` : "";
        li.innerHTML = `
            ${logoUrl ? `<img src="${logoUrl}" alt="${team.name}" width="24" height="24" style="object-fit: contain;">` : "<span style='display:inline-block;width:24px;height:24px;border-radius:50%;background:#4b5563;'></span>"}
            <span>${team.name}</span>
        `;

        li.addEventListener("click", () => addTeam(team));
        resultsList.appendChild(li);
    })

    resultsList.classList.remove("hidden");


}

const resultsList = document.getElementById("results-list");

let addTeam = async (team) => {
    chrome.storage.local.get({ savedTeams: [] }, (result) => {
        const savedTeams = result.savedTeams;
        const alreadySaved = savedTeams.some((savedTeam) => savedTeam.id === team.id);

        if (alreadySaved) {
            resultsList.innerHTML = `<li style='color:#f59e0b;'>${team.name} is already saved.</li>`;
        } else {
            chrome.storage.local.set({ savedTeams: [...savedTeams, team] }, () => {
                console.log(`Saved ${team.name} to storage!`);
                resultsList.innerHTML = `<li style='color:#10b981;'>Successfully added ${team.name}!</li>`;
            });
        }

        inputArea.value = "";

        clearTimeout(resultsMessageTimeout);
        resultsMessageTimeout = setTimeout(() => {
            resultsList.classList.add("hidden");
            resultsList.innerHTML = "";
        }, 2000);
    });
}