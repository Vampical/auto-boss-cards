"use strict";

const DAMAGE_STATS = [
    "power",
    "physicalAttack",
    "magicalAttack",
    "physicalCritPower",
    "magicalCritPower",
    "physicalPiercing",
    "magicalPiercing",
    "physicalDefenseReduction",
    "magicalDefenseReduction"
];

function playerStats(event) {
    const sum = (field, bonus) => Number(event[field] ?? NaN) + Number(event[bonus] ?? 0);
    const attack = kind => (Number.isFinite(Number(event[`attack${kind}Min`])) ? (sum(
        `attack${kind}Min`,
        `attack${kind}MinBonus`
    ) + sum(
        `attack${kind}Max`,
        `attack${kind}MaxBonus`
    )) / 2 : sum(
        `attack${kind}Max`,
        `attack${kind}MaxBonus`
    ));

    return {
        power: sum("power", "powerBonus"),
        genericCritical: sum("critPower", "critPowerBonus"),
        physicalAttack: attack("Physical"),
        magicalAttack: attack("Magical"),
        physicalCritPower: sum("critPowerPhysical", "critPowerPhysicalBonus"),
        magicalCritPower: sum("critPowerMagical", "critPowerMagicalBonus"),
        physicalPiercing: sum("piercingPhysical", "piercingPhysicalBonus"),
        magicalPiercing: sum("piercingMagical", "piercingMagicalBonus"),
        physicalDefenseReduction: sum("defenseReductionPhysical", "defenseReductionPhysicalBonus"),
        magicalDefenseReduction: sum("defenseReductionMagical", "defenseReductionMagicalBonus")
    };
}

function skillRanks(skills, previous) {
    const ranks = new Map(previous);

    for (const skill of skills) {
        const id = Number(skill.id);

        if (!skill.active || !Number.isSafeInteger(id) || id <= 0) continue;

        const group = Math.floor(id / 10000);
        const rank = Math.floor(id / 100) % 100;

        ranks.set(group, Math.max(ranks.get(group) ?? -1, rank));
    }

    return ranks;
}

function profile(stats, skills, metric, ranks) {
    if (!stats || !(ranks instanceof Map)) return null;

    let type = null;

    if (metric.startsWith("physical")) {
        type = "physical";
    } else if (metric.startsWith("magical")) {
        type = "magical";
    }

    if (!type) return null;

    const relevant = skills.filter(
        skill => skill.type === type && skill.physical >= 0 && skill.magical >= 0 && skill.physical + skill.magical > 0 && (skill.basePower === undefined || Number.isFinite(skill.basePower) && skill.basePower > 0)
    );

    if (!relevant.length) return null;

    const groups = new Map();

    for (const skill of relevant) {
        const group = Math.floor(skill.id / 10000);
        const rank = Math.floor(skill.id / 100) % 100;

        if (ranks.get(group) === rank && !groups.has(group)) {
            groups.set(group, skill);
        }
    }

    let physical = 0;
    let magical = 0;
    let total = 0;

    for (const skill of groups.values()) {
        const weight = skill.basePower ?? 1;

        physical += skill.physical * weight;
        magical += skill.magical * weight;
        total += weight;
    }

    if (!total || !["physicalAttack", "magicalAttack", "physicalCritPower", "magicalCritPower"].every(key => Number.isFinite(stats[key])) || stats.physicalAttack < 0 || stats.magicalAttack < 0)
        return null;

    return {
        stats: Object.fromEntries(DAMAGE_STATS.map(key => [key, stats[key]])),
        genericCritical: Number.isFinite(stats.genericCritical) ? Math.max(0, stats.genericCritical) : 0,
        type,
        physical: physical / total,
        magical: magical / total
    };
}

function penetrationRate(piercing) {
    const value = Math.fround(Math.max(0, piercing));

    // Keep float32 rounding consistent at the penetration cap.
    return Math.min(
        Math.fround(0.8),
        Math.fround(value / Math.fround(value + 10000))
    );
}

// Apply flat reduction before percentage piercing; negative resistance skips piercing.
function resistanceFactor(model, piercing, reduction) {
    // Common resistance used when no custom comparison value is supplied.
    const baseline = model.defense ?? 43500;
    let defense = Math.max(-33333, baseline - Math.max(0, reduction));

    if (defense >= 0) {
        defense *= 1 - penetrationRate(piercing);
    }

    return 100000 / (100000 + defense);
}

function criticalDamage(model, values) {
    const genericCritical = (model.genericCritical || 0) * 0.9;

    // Use the fallback only for a nonpositive critical coefficient.
    return Math.max(
        0,
        1 + values.power / 100
    ) * ((genericCritical > 0 ? genericCritical : 0.1) + Math.max(
        0,
        values.amplification
    ) * Math.max(
        1,
        values.critical
    ) * resistanceFactor(
        model,
        values.piercing,
        values.reduction
    ) / 100000) * Math.max(0, Math.fround(1 + (values.damageBonus || 0)));
}

// Compare critical-hit gains using the shared resistance value.
// Additional live debuffs and positional modifiers are not included.
function damageValue(model, bonuses = {}) {
    const stats = model.stats;
    const amplification = (stats.physicalAttack + (bonuses.physicalAttack || 0)) * model.physical + (stats.magicalAttack + (bonuses.magicalAttack || 0)) * model.magical;
    const power = Number.isFinite(stats.power) ? stats.power : 0;

    return criticalDamage(model, {
        power: power + (bonuses.power || 0),
        amplification,
        critical: stats[`${model.type}CritPower`] + (bonuses[`${model.type}CritPower`] || 0),
        piercing: (stats[`${model.type}Piercing`] || 0) + (bonuses[`${model.type}Piercing`] || 0),
        reduction: (stats[`${model.type}DefenseReduction`] || 0) + (bonuses[`${model.type}DefenseReduction`] || 0),
        damageBonus: Math.fround((model.damageBonus || 0) + (bonuses.damageBonus || 0))
    });
}

module.exports = {
    DAMAGE_STATS,
    playerStats,
    skillRanks,
    profile,
    damageValue,
    criticalDamage,
    penetrationRate,
    resistanceFactor
};
