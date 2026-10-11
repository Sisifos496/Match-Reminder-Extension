const test = require("node:test");
const assert = require("node:assert/strict");
const { getTeamSearchQueries } = require("./search-queries");

test("PSG searches for the men’s team before women’s-team aliases", () => {
    const queries = getTeamSearchQueries("PSG", [{ strGender: "Male", strTeam: "PSG Talon" }]);

    assert.deepEqual(queries, [
        "PSG",
        "Paris Saint Germain",
        "PSG Women",
        "Paris Saint-Germain Women",
        "PSG FC",
        "PSG United",
        "PSG City",
        "PSG Women FC"
    ]);
});

test("generic club names include common official-name variants", () => {
    const queries = getTeamSearchQueries("Leeds", []);

    assert.deepEqual(queries, [
        "Leeds",
        "Leeds FC",
        "Leeds United",
        "Leeds City",
        "Leeds Women",
        "Leeds Women FC"
    ]);
});
