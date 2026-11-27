"use strict";

const STATS = Object.freeze({
    power: {
        types: [3]
    },
    magicalDefense: {
        types: [1004, 117]
    },
    physicalCritPower: {
        types: [1005, 1103]
    },
    magicalCritPower: {
        types: [1006, 1104]
    },
    physicalAttack: {
        types: [1001, 1101]
    },
    magicalAttack: {
        types: [1002, 1102]
    },
    physicalPiercing: {
        types: [1007]
    },
    magicalPiercing: {
        types: [1008]
    },
    physicalDefenseReduction: {
        types: [1009]
    },
    magicalDefenseReduction: {
        types: [1010]
    },
    physicalDefense: {
        types: [1003, 116]
    },
    critFactor: {
        types: [6]
    }
});

// Each class has a default priority and an estimated share of critical hits from dungeon fights.
const JOBS = [
    ["Warrior", "physicalCritPower", 0.95],
    ["Lancer", "physicalCritPower", 0.85],
    ["Slayer", "physicalCritPower", 0.93],
    ["Berserker", "physicalCritPower", 0.92],
    ["Sorcerer", "magicalCritPower", 0.86],
    ["Archer", "physicalCritPower", 0.92],
    ["Priest", "magicalDefense", 0.79],
    ["Mystic", "magicalDefense", 0.68],
    ["Reaper", "magicalCritPower", 0.77],
    ["Gunner", "magicalCritPower", 0.89],
    ["Brawler", "physicalCritPower", 0.93],
    ["Ninja", "magicalCritPower", 0.9],
    ["Valkyrie", "physicalCritPower", 0.92]
];

const DEFAULTS = {
    enabled: true,
    optimizePower: true,
    priority: "class",
    secondary: "none",
    collectionPriority: "cards",
    collectionSecondary: "auto",
    useSpecies: true,
    detectOnSpawn: true,
    includeBams: true,
    detectionRange: 100,
    manageCombines: true,
    dryRun: false,
    notifications: true,
    debug: false,
    operationDelay: 120,
    acknowledgementTimeout: 5000
};

JOBS.forEach((job, id) => {
    DEFAULTS[`job${id}`] = job[1];
});

function normalize(settings = {}) {
    const result = {
        ...DEFAULTS,
        ...settings
    };

    // Language follows Toolbox and is never an independent module preference.
    delete result.language;

    for (const key of [
        "enabled",
        "optimizePower",
        "useSpecies",
        "detectOnSpawn",
        "includeBams",
        "manageCombines",
        "dryRun",
        "notifications",
        "debug"
    ]) {
        if (typeof result[key] !== "boolean") {
            result[key] = DEFAULTS[key];
        }
    }

    if (result.priority !== "class" && !STATS[result.priority]) {
        result.priority = "class";
    }

    if (result.secondary !== "none" && !STATS[result.secondary]) {
        result.secondary = "none";
    }

    if (result.collectionPriority !== "cards" && !STATS[result.collectionPriority]) {
        result.collectionPriority = "cards";
    }

    if (!["auto", "none"].includes(result.collectionSecondary) && !STATS[result.collectionSecondary]) {
        result.collectionSecondary = "auto";
    }

    JOBS.forEach((job, id) => {
        if (!STATS[result[`job${id}`]]) {
            result[`job${id}`] = job[1];
        }
    });

    for (const [key, min, max] of [
        ["operationDelay", 50, 2000],
        ["acknowledgementTimeout", 1000, 30000],
        ["detectionRange", 10, 300]
    ]) {
        result[key] = Number.isFinite(Number(result[key])) ? Math.max(min, Math.min(max, Math.round(Number(result[key])))) : DEFAULTS[key];
    }

    return result;
}

function priorities(settings, job) {
    const primary = settings.priority === "class" ? settings[`job${job}`] : settings.priority;

    return [STATS[primary] ? primary : null, STATS[settings.secondary] ? settings.secondary : null];
}

function collectionPriorities(settings, cardMetrics) {
    const primary = settings.collectionPriority === "cards" ? cardMetrics[0] : settings.collectionPriority;

    const fallback = {
        physicalCritPower: "physicalAttack",
        magicalCritPower: "magicalAttack"
    };

    let secondary = settings.collectionSecondary;

    if (secondary === "auto") {
        secondary = cardMetrics[1] || fallback[primary] || null;
    } else if (secondary === "none") {
        secondary = null;
    }

    return [primary, secondary === primary ? null : secondary];
}

function selectionMode(settings, job) {
    const metrics = priorities(settings, job);
    const primary = metrics[0];
    const healer = [6, 7].includes(job);
    const healerSupport = healer && primary === "magicalDefense";
    const offensive = primary === "power" || /^(physical|magical)(CritPower|Attack|Piercing|DefenseReduction)$/.test(primary);
    const healerOffense = healer && offensive;
    const powerMode = settings.optimizePower && (offensive || healerSupport);

    if (healerOffense) metrics[1] = null;

    let collectionMetrics = collectionPriorities(settings, metrics);

    if (healerSupport || healerOffense) {
        collectionMetrics = [...metrics];
    } else if (powerMode) {
        collectionMetrics = collectionPriorities({
            ...settings,
            collectionPriority: "cards",
            collectionSecondary: "auto"
        }, metrics);
    }

    return {
        metrics,
        collectionMetrics,
        healerSupport,
        healerOffense,
        healerCrit: healer && primary === "magicalCritPower",
        powerMode,
        damageMode: powerMode,
        collectionAuto: powerMode || healerSupport || healerOffense || settings.collectionPriority === "cards",
        profileMetric: primary === "power" ? JOBS[job]?.[1] || primary : primary,
        criticalChance: JOBS[job]?.[2] ?? 0.85
    };
}

module.exports = {
    STATS,
    JOBS,
    DEFAULTS,
    normalize,
    priorities,
    collectionPriorities,
    selectionMode
};
