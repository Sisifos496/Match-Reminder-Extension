const savedTeamsList = document.getElementById("saved-teams-list");

function renderSavedTeams(savedTeams) {
    savedTeamsList.innerHTML = "";

    if (savedTeams.length === 0) {
        savedTeamsList.innerHTML = "<li class='empty-state'>No teams saved yet.</li>";
        return;
    }

    savedTeams.forEach((team) => {
        const listItem = document.createElement("li");
        listItem.className = "team-item";
        listItem.tabIndex = 0;

        const logoUrl = team.logo ? `${team.logo}/preview` : "";
        listItem.innerHTML = `
            <div class="team-details">
                ${logoUrl ? `<img class="team-logo" src="${logoUrl}" alt="${team.name}">` : '<span class="team-logo" style="display:inline-flex;align-items:center;justify-content:center;background:#4b5563;border-radius:50%;color:#fff;font-size:12px;">T</span>'}
                <span>${team.name}</span>
            </div>
            <button class="remove-button" type="button">Remove</button>
        `;

        const openTeamPage = () => {
            const params = new URLSearchParams({
                id: team.id,
                name: team.name,
                logo: team.logo
            });
            window.location.href = `team-matches.html?${params}`;
        };

        listItem.addEventListener("click", (event) => {
            if (!event.target.closest(".remove-button")) {
                openTeamPage();
            }
        });
        listItem.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openTeamPage();
            }
        });

        listItem.querySelector(".remove-button").addEventListener("click", () => {
            chrome.storage.local.get({ savedTeams: [] }, (result) => {
                const remainingTeams = result.savedTeams.filter(
                    (savedTeam) => savedTeam.id !== team.id
                );
                chrome.storage.local.set({ savedTeams: remainingTeams }, () => {
                    renderSavedTeams(remainingTeams);
                });
            });
        });

        savedTeamsList.appendChild(listItem);
    });
}

chrome.storage.local.get({ savedTeams: [] }, (result) => {
    renderSavedTeams(result.savedTeams);
});
