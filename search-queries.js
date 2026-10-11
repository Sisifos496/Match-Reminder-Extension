const teamAliasQueries = {
    psg: ["Paris Saint Germain", "PSG Women", "Paris Saint-Germain Women"],
    "paris saint germain": ["PSG Women", "Paris Saint-Germain Women"],
    "paris saint-germain": ["PSG Women", "Paris Saint-Germain Women"]
};

const genericSuffixQueries = ["FC", "United", "City", "Women", "Women FC"];

function getTeamSearchQueries(searchQuery, primaryTeams = []) {
    const normalizedQuery = searchQuery.trim();
    const hasFemaleTeam = primaryTeams.some((team) => team.strGender === "Female");
    const knownFallbacks = teamAliasQueries[normalizedQuery.toLowerCase()] || [];
    const genericFallbacks = genericSuffixQueries
        .filter((suffix) => !normalizedQuery.toLowerCase().endsWith(suffix.toLowerCase()))
        .map((suffix) => `${normalizedQuery} ${suffix}`);

    return [
        normalizedQuery,
        ...knownFallbacks,
        ...genericFallbacks
    ].filter((value, index, values) => value && values.indexOf(value) === index);
}

if (typeof globalThis !== "undefined") {
    globalThis.getTeamSearchQueries = getTeamSearchQueries;
}

if (typeof module !== "undefined") {
    module.exports = { getTeamSearchQueries };
}
