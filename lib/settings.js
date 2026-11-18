"use strict";

function createStatOptions() {
    return [
        {
            key: "power",
            name: "Power"
        },
        {
            key: "magicalDefense",
            name: "Magical defense"
        },
        {
            key: "physicalCritPower",
            name: "Physical crit power"
        },
        {
            key: "magicalCritPower",
            name: "Magical crit power"
        },
        {
            key: "physicalAttack",
            name: "Physical attack"
        },
        {
            key: "magicalAttack",
            name: "Magical attack"
        },
        {
            key: "physicalPiercing",
            name: "Physical piercing"
        },
        {
            key: "magicalPiercing",
            name: "Magical piercing"
        },
        {
            key: "physicalDefenseReduction",
            name: "Flat physical resistance reduction"
        },
        {
            key: "magicalDefenseReduction",
            name: "Flat magical resistance reduction"
        },
        {
            key: "physicalDefense",
            name: "Physical defense"
        },
        {
            key: "critFactor",
            name: "Crit factor"
        }
    ];
}

module.exports = [
    {
        key: "enabled",
        name: "<b>Automatically select cards</b>",
        type: "bool"
    },
    {
        key: "priority",
        name: "<b>Primary card stat</b>",
        type: "select",
        options: [
            {
                key: "class",
                name: "Use the class settings below"
            },
            ...createStatOptions()
        ]
    },
    {
        key: "optimizePower",
        name: "Select cards by damage with Power and piercing",
        type: "bool"
    },
    {
        key: "secondary",
        name: "Card tiebreaker stat",
        type: "select",
        options: [
            {
                key: "none",
                name: "None"
            },
            ...createStatOptions()
        ]
    },
    {
        key: "collectionPriority",
        name: "Primary collection stat",
        type: "select",
        options: [
            {
                key: "cards",
                name: "Auto: damage gain / card stat for healers"
            },
            ...createStatOptions()
        ]
    },
    {
        key: "collectionSecondary",
        name: "Collection tiebreaker stat",
        type: "select",
        options: [
            {
                key: "auto",
                name: "Auto (attack for crit power)"
            },
            {
                key: "none",
                name: "None"
            },
            ...createStatOptions()
        ]
    },
    {
        key: "useSpecies",
        name: "Include bonuses against the target species",
        type: "bool"
    },
    {
        key: "detectOnSpawn",
        name: "Recognize known bosses on spawn",
        type: "bool"
    },
    {
        key: "includeBams",
        name: "Select cards for BAMs too",
        type: "bool"
    },
    {
        key: "detectionRange",
        name: "Nearest boss / BAM detection range, m",
        type: "number",
        min: 10,
        max: 300,
        step: 10
    },
    {
        key: "manageCombines",
        name: "Automatically select collection effects",
        type: "bool"
    },
    {
        key: "dryRun",
        name: "Preview only (do not change cards or collections)",
        type: "bool"
    },
    {
        key: "notifications",
        name: "Show selected sets in chat",
        type: "bool"
    },
    {
        key: "job0",
        name: "Warrior — priority",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job1",
        name: "Lancer — priority",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job2",
        name: "Slayer — priority",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job3",
        name: "Berserker — priority",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job4",
        name: "Sorcerer — priority",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job5",
        name: "Archer — priority",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job6",
        name: "Priest — priority",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job7",
        name: "Mystic — priority",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job8",
        name: "Reaper — priority",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job9",
        name: "Gunner — priority",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job10",
        name: "Brawler — priority",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job11",
        name: "Ninja — priority",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job12",
        name: "Valkyrie — priority",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "operationDelay",
        name: "Delay between confirmed changes, ms",
        type: "number",
        min: 50,
        max: 2000,
        step: 10
    },
    {
        key: "acknowledgementTimeout",
        name: "Server reply timeout, ms",
        type: "number",
        min: 1000,
        max: 30000,
        step: 500
    },
    {
        key: "debug",
        name: "Debug messages in the Toolbox console",
        type: "bool"
    }
];
