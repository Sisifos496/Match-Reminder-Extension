console.log("Match Reminder content script loaded.");

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

function showLineupReminder(matches, reminderMinutes) {
    const existing = document.getElementById("match-reminder-popup");
    if (existing) {
        existing.remove();
    }

    const popup = document.createElement("aside");
    popup.id = "match-reminder-popup";
    popup.setAttribute("role", "alert");
    popup.style.cssText = [
        "background:#621939",
        "border:1px solid #dc96b4",
        "border-radius:8px",
        "box-shadow:0 10px 30px rgba(0,0,0,.45)",
        "color:#f2e8ed",
        "font:16px sans-serif",
        "line-height:1.45",
        "max-width:360px",
        "padding:18px 44px 18px 18px",
        "position:fixed",
        "right:24px",
        "top:24px",
        "z-index:2147483647"
    ].join(";");

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "x";
    closeButton.setAttribute("aria-label", "Close reminder");
    closeButton.style.cssText = "background:transparent;border:0;color:inherit;cursor:pointer;font-size:22px;position:absolute;right:12px;top:8px;";
    closeButton.addEventListener("click", () => popup.remove());
    popup.appendChild(closeButton);

    const title = document.createElement("strong");
    title.textContent = reminderMinutes === 10
        ? "Match starts in 10 minutes"
        : "Match starts in 1 hour";
    popup.appendChild(title);

    matches.forEach((match) => {
        const matchLine = document.createElement("div");
        matchLine.textContent = `${match.homeTeam} vs ${match.awayTeam}`;
        popup.appendChild(matchLine);
    });

    document.documentElement.appendChild(popup);
    playReminderSound();
}

chrome.storage.local.get({ savedTeams: [] }, (result) => {
    if (result.savedTeams) {
        for (const team of result.savedTeams) {
            console.log("Currently following: " + team.name);
        }
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "show_lineup_reminder") {
        showLineupReminder(request.matches || [], request.reminderMinutes);
    }

    if (request.action === "show_match_alert") {
        alert(`Match Reminder: ${request.teamName} is playing soon!`);
    }
});