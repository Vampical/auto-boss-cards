"use strict";

const { STATS } = require("./config");

const { METHOD } = require("./passivity");

// Conditional stat fields replace previous values rather than stacking.
const REPLACEMENTS = Object.freeze({
    116: "physicalDefense",
    117: "magicalDefense",
    1101: "physicalAttack",
    1102: "magicalAttack",
    1103: "physicalCritPower",
    1104: "magicalCritPower"
});

const METRICS = new Map(Object.entries(STATS).flatMap(([name, stat]) => stat.types.map(type => [type, name])));

function effects(passiveIds, catalog, context) {
    const additive = {};
    const replacement = {};

    for (const id of passiveIds) {
        const p = catalog.passives.get(id);
        const metric = p && METRICS.get(p.type);

        if (!metric || p.kind !== 0 || p.method !== METHOD.ADD_ABSOLUTE || p.prob !== 1 || p.conditionValue !== 0 || ![0, 15, 25].includes(p.condition)) continue;

        if (REPLACEMENTS[p.type]) {
            if (context.healerSupport && metric === "magicalDefense") continue;

            if (p.mobSize !== "all" && p.mobSize !== context.size) continue;

            if (p.species && (!context.useSpecies || p.species !== context.species)) continue;

            const amount = [116, 117, 1101, 1102].includes(p.type) ? Math.trunc(p.value) : p.value;
            const old = replacement[metric];

            replacement[metric] = old ? {
                min: Math.min(old.min, amount),
                max: Math.max(old.max, amount)
            } : {
                min: amount,
                max: amount
            };
        } else {
            // General stat bonuses apply without species or target-size restrictions.
            additive[metric] = (additive[metric] || 0) + p.value;
        }
    }

    return {
        additive,
        replacement
    };
}

function mergeEffects(a, b) {
    const additive = {
        ...a.additive
    };

    const replacement = {
        ...a.replacement
    };

    for (const [key, amount] of Object.entries(b.additive)) {
        additive[key] = (additive[key] || 0) + amount;
    }

    for (const [key, amount] of Object.entries(b.replacement)) {
        const old = replacement[key];

        replacement[key] = old ? {
            min: Math.min(old.min, amount.min),
            max: Math.max(old.max, amount.max)
        } : amount;
    }

    return {
        additive,
        replacement
    };
}

function value(effect, metric, upper = false) {
    if (!metric) return 0;

    return (effect.additive[metric] || 0) + (effect.replacement[metric]?.[upper ? "max" : "min"] || 0);
}

function score(passiveIds, catalog, metric, context) {
    return value(effects(passiveIds, catalog, context), metric);
}

function staticScore(passiveIds, catalog, metric, context) {
    return effects(passiveIds, catalog, context).additive[metric] || 0;
}

function conflicts(effect) {
    return Object.entries(effect.replacement).filter(([, range]) => range.min !== range.max);
}

module.exports = {
    REPLACEMENTS,
    effects,
    mergeEffects,
    value,
    score,
    staticScore,
    conflicts
};
