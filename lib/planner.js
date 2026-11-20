"use strict";

const { STATS } = require("./config");
const { damageValue, criticalDamage } = require("./damage");
const { TYPES, METHOD: PASSIVE_METHOD } = require("./passivity");
const { METHOD: ABNORMALITY_METHOD } = require("./abnormality");
const { effects, mergeEffects, value: effectValue, score, conflicts } = require("./effects");

const EPSILON = 1e-9;

function empty() {
    return {
        ids: [],
        primary: 0,
        secondary: 0,
        retained: 0,
        cost: 0
    };
}

function add(a, b, metrics) {
    const effect = mergeEffects(a.effects, b.effects);

    return {
        effects: effect,
        ids: a.ids.concat(b.ids),
        retained: a.retained + b.retained,
        cost: a.cost + b.cost,
        primary: effectValue(effect, metrics[0]),
        secondary: effectValue(effect, metrics[1])
    };
}

function compare(a, b) {
    if (!b) return 1;

    for (const difference of [a.primary - b.primary, a.secondary - b.secondary]) {
        if (Math.abs(difference) > EPSILON) return Math.sign(difference);
    }

    return stableTie(a, b);
}

function stableTie(a, b) {
    if (a.retained !== b.retained) return Math.sign(a.retained - b.retained);

    if (a.ids.length !== b.ids.length) return Math.sign(b.ids.length - a.ids.length);

    if (a.cost !== b.cost) return Math.sign(b.cost - a.cost);

    const left = a.ids.slice().sort((x, y) => x - y);
    const right = b.ids.slice().sort((x, y) => x - y);

    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return Math.sign(right[i] - left[i]);
    }

    return 0;
}

function put(table, key, candidate) {
    if (compare(candidate, table.get(key)) > 0) {
        table.set(key, candidate);
    }
}

function contribution(id, passives, cost, equipped, catalog, metrics, context) {
    const effect = effects(passives, catalog, context);

    return {
        effects: effect,
        ids: [id],
        primary: effectValue(effect, metrics[0]),
        secondary: effectValue(effect, metrics[1]),
        retained: equipped.has(id) ? 1 : 0,
        cost
    };
}

function replacementKey(state, metrics) {
    return metrics.filter(Boolean).map(metric => Number(!!state.effects.replacement[metric])).join("");
}

function replacementDominates(a, b, metrics) {
    return metrics.filter(Boolean)
        .every(metric => (a.effects.replacement[metric]?.min || 0) >= (b.effects.replacement[metric]?.min || 0) - EPSILON);
}

// The passive-slot order is not in the protocol.
// Replacements use their lower bound, not a sum or an assumed mounting order.
// Preserve additive and replacing components separately: a future weak replacement can erase an advantage.
function putStatFrontier(table, state, metrics) {
    const key = `${state.ids.length}:${state.cost}:${replacementKey(state, metrics)}`;

    const dominates = (a, b) => {
        if (!replacementDominates(a, b, metrics)) return false;

        const differences = metrics.map(metric => (a.effects.additive[metric] || 0) - (b.effects.additive[metric] || 0));

        if (differences.some(difference => difference < -EPSILON)) return false;

        return differences.some(difference => difference > EPSILON) || stableTie(a, b) >= 0;
    };

    const previous = table.get(key) || [];

    if (previous.some(other => dominates(other, state))) return;

    table.set(key, previous.filter(other => !dominates(state, other)).concat(state));
}

function planDeck(catalog, registered, equipped, limits, metrics, context) {
    const properties = new Map();

    for (const [id, amount] of registered) {
        const card = catalog.cards.get(id);

        if (!card || amount !== card.activation || card.cost < 0 || !Number.isInteger(card.cost) || card.cost > limits.cost) continue;

        const candidate = contribution(id, card.passives, card.cost, equipped, catalog, metrics, context);

        if (context.healerSupport && !(candidate.effects.additive.magicalDefense > 0)) continue;

        if (!properties.has(card.property)) {
            properties.set(card.property, new Map());
        }

        const categories = properties.get(card.property);

        if (!categories.has(card.category)) {
            categories.set(card.category, []);
        }

        categories.get(card.category).push(candidate);
    }

    const initial = {
        ...empty(),
        effects: effects(context.fixedPassives || [], catalog, context)
    };

    initial.primary = effectValue(initial.effects, metrics[0]);
    initial.secondary = effectValue(initial.effects, metrics[1]);

    const hasReplacements = Array.from(properties.values()).some(
        categories => Array.from(categories.values())
            .some(options => options.some(option => metrics.some(metric => option.effects.replacement[metric])))
    ) || metrics.some(metric => initial.effects.replacement[metric]);

    const insert = (table, state) => (hasReplacements ? putStatFrontier(
        table,
        state,
        metrics
    ) : put(
        table,
        `${state.ids.length}:${state.cost}`,
        state
    ));
    const states = table => (hasReplacements ? Array.from(table.values()).flat() : table.values());

    const newTable = state => {
        const table = new Map();

        insert(table, state);

        return table;
    };

    let total = newTable(initial);

    // Multiple-choice knapsack per property: one rarity per category, bounded duplicates.
    for (const categories of properties.values()) {
        let property = newTable({
            ...empty(),
            effects: effects([], catalog, context)
        });

        for (const options of categories.values()) {
            const next = new Map(property);

            for (const state of states(property)) {
                if (state.ids.length >= Math.min(limits.slots, limits.duplicates)) continue;

                for (const option of options) {
                    if (state.cost + option.cost > limits.cost) continue;

                    const candidate = add(state, option, metrics);

                    insert(next, candidate);
                }
            }

            property = next;
        }

        const next = new Map();

        for (const a of states(total)) {
            for (const b of states(property)) {
                if (a.ids.length + b.ids.length > limits.slots || a.cost + b.cost > limits.cost) continue;

                const candidate = add(a, b, metrics);

                insert(next, candidate);
            }
        }

        total = next;
    }

    let best = initial;

    for (const state of states(total)) {
        if (compare(state, best) > 0) {
            best = state;
        }
    }

    return {
        ...best,
        primary: best.primary - initial.primary,
        secondary: best.secondary - initial.secondary,
        conflicts: conflicts(best.effects)
    };
}

function collectionPassives(catalog, registered) {
    const categoryLevels = new Map();

    for (const [id, amount] of registered) {
        const card = catalog.cards.get(id);

        if (card && amount === card.activation) {
            categoryLevels.set(card.category, Math.max(card.level, categoryLevels.get(card.category) ?? -1));
        }
    }

    const available = [];

    for (const combine of catalog.combines.values()) {
        if (!combine.categories.length || !combine.categories.every(category => categoryLevels.has(category))) continue;

        const level = Math.min(...combine.categories.map(category => categoryLevels.get(category)));

        // Use one rarity bonus: level 2 replaces level 1 rather than stacking.
        const passiveIds = combine.passives.filter(passive => passive.minLevel === 0 || passive.minLevel === level)
            .map(passive => passive.id);

        available.push({
            id: combine.id,
            passiveIds
        });
    }

    return available;
}

function planDamageDeck(catalog, registered, equipped, limits, metrics, context) {
    const model = context.damage;

    const criticalStat = `${model.type}CritPower`;
    const piercingStat = `${model.type}Piercing`;
    const reductionStat = `${model.type}DefenseReduction`;
    const dynamicMetrics = Array.from(new Set(["physicalAttack", "magicalAttack", criticalStat, ...metrics.filter(Boolean)]));

    const zero = (fixed = false) => {
        const effect = effects(fixed ? context.fixedPassives || [] : [], catalog, context);

        return {
            ...empty(),
            effects: effect,
            primary: effectValue(effect, metrics[0]),
            secondary: effectValue(effect, metrics[1]),
            power: effect.additive.power || 0,
            amplification: model.physical * (effect.additive.physicalAttack || 0) + model.magical * (effect.additive.magicalAttack || 0),
            critical: effect.additive[criticalStat] || 0,
            piercing: effect.additive[piercingStat] || 0,
            reduction: effect.additive[reductionStat] || 0,
            damageBonus: effect.additive.damageBonus || 0
        };
    };

    const merge = (a, b) => ({
        ...add(a, b, metrics),
        power: a.power + b.power,
        amplification: a.amplification + b.amplification,
        critical: a.critical + b.critical,
        piercing: a.piercing + b.piercing,
        reduction: a.reduction + b.reduction,
        damageBonus: Math.fround(a.damageBonus + b.damageBonus)
    });

    let strictPower = false;
    let strictAmplification = false;
    let strictCritical = false;

    // A single winner per cost/slot would lose valid Power vs crit tradeoffs.
    // Keep the entire Pareto frontier until the final nonlinear comparison.
    const lower = (state, metric) => state.effects.replacement[metric]?.min || 0;

    const dominates = (a, b, unsettled) => {
        // General magical defense is additive.
        // For support healers, a higher value at the same cost/slot count wins before any damage tradeoff.
        if (context.healerSupport && Math.abs(a.primary - b.primary) > EPSILON) return a.primary > b.primary;

        if (!replacementDominates(a, b, unsettled)) return false;

        const settledDifference = metric => (unsettled.includes(metric) ? 0 : lower(a, metric) - lower(b, metric));

        const differences = [
            a.power - b.power,
            a.amplification - b.amplification + model.physical * settledDifference("physicalAttack") + model.magical * settledDifference("magicalAttack"),
            a.critical - b.critical + settledDifference(criticalStat),
            a.piercing - b.piercing,
            a.reduction - b.reduction,
            a.damageBonus - b.damageBonus
        ];

        if (differences.some(value => value < -EPSILON)) return false;

        if (strictPower && differences[0] > EPSILON || strictAmplification && differences[1] > EPSILON || strictCritical && differences[2] > EPSILON) return true;

        // At a penetration cap, a larger raw stat can produce the same damage.
        // Preserve the better retention/stat tie as well as the numeric frontier.
        const statDifferences = metrics.map(metric => (a.effects.additive[metric] || 0) - (b.effects.additive[metric] || 0) + settledDifference(metric));

        return statDifferences.every(difference => difference >= -EPSILON) && (statDifferences.some(difference => difference > EPSILON) || stableTie(
            a,
            b
        ) >= 0);
    };

    function putFrontier(table, value, unsettled = dynamicMetrics) {
        const key = `${value.ids.length}:${value.cost}:${replacementKey(value, unsettled)}`;
        const frontier = table.get(key) || [];

        if (frontier.some(previous => dominates(previous, value, unsettled))) return;

        table.set(key, frontier.filter(previous => !dominates(value, previous, unsettled)).concat(value));
    }

    const properties = new Map();

    for (const [id, amount] of registered) {
        const card = catalog.cards.get(id);

        if (!card || amount !== card.activation || !Number.isInteger(card.cost) || card.cost < 0 || card.cost > limits.cost) continue;

        if (!properties.has(card.property)) {
            properties.set(card.property, new Map());
        }

        const categories = properties.get(card.property);

        if (!categories.has(card.category)) {
            categories.set(card.category, []);
        }

        const candidate = contribution(id, card.passives, card.cost, equipped, catalog, metrics, context);

        const option = {
            ...candidate,
            power: candidate.effects.additive.power || 0,
            amplification: model.physical * (candidate.effects.additive.physicalAttack || 0) + model.magical * (candidate.effects.additive.magicalAttack || 0),
            critical: candidate.effects.additive[criticalStat] || 0,
            piercing: candidate.effects.additive[piercingStat] || 0,
            reduction: candidate.effects.additive[reductionStat] || 0,
            damageBonus: candidate.effects.additive.damageBonus || 0
        };

        if (option.retained && !context.healerSupport || option.primary > 0 || option.secondary > 0 || option.power > 0 || option.amplification > 0 || option.critical > 0 || option.piercing > 0 || option.reduction > 0 || option.damageBonus > 0 || dynamicMetrics.some(metric => lower(
            option,
            metric
        ) > 0)) {
            categories.get(card.category).push(option);
        }
    }

    const options = Array.from(properties.values()).flatMap(categories => Array.from(categories.values()).flat());
    const lowerDynamicAmplification = state => model.physical * (state.effects.replacement.physicalAttack?.min || 0) + model.magical * (state.effects.replacement.magicalAttack?.min || 0);
    const initial = zero(true);

    const minimum = (key, base) => base + options.map(option => {
        let adjustment = 0;

        if (key === "amplification") {
            adjustment = lowerDynamicAmplification(option);
        } else if (key === "critical") {
            adjustment = option.effects.replacement[criticalStat]?.min || 0;
        }

        return Math.min(0, option[key] + adjustment);
    }).sort((a, b) => a - b).slice(0, limits.slots).reduce((sum, value) => sum + value, 0);

    const base = model.physical * model.stats.physicalAttack + model.magical * model.stats.magicalAttack;

    // Conservative bounds include even incompatible negative options.
    // Strict improvement is safe only when no continuation can reach a clamp.
    const minAmplification = minimum("amplification", base + initial.amplification + Math.min(0, lowerDynamicAmplification(initial)));
    const positiveMultiplier = 1 + minimum("damageBonus", (model.damageBonus || 0) + initial.damageBonus) > 0;

    strictPower = minAmplification > 0 && positiveMultiplier;
    strictAmplification = minimum("power", model.stats.power + initial.power) > -100 && positiveMultiplier;
    strictCritical = strictAmplification && minAmplification > 0 && minimum(
        "critical",
        model.stats[criticalStat] + initial.critical + Math.min(
            0,
            initial.effects.replacement[criticalStat]?.min || 0
        )
    ) >= 1;
    let total = new Map();

    putFrontier(total, initial);

    const groups = Array.from(properties.values(), categories => ({
        categories,
        replace: new Set(
            Array.from(categories.values())
                .flat()
                .flatMap(option => Object.keys(option.effects.replacement)
                    .filter(metric => dynamicMetrics.includes(metric)))
        )
    }));

    groups.sort((a, b) => b.replace.size - a.replace.size);

    for (let index = 0; index < groups.length; index++) {
        const { categories, replace } = groups[index];

        const future = dynamicMetrics.filter(metric => groups.slice(index + 1).some(group => group.replace.has(metric)));
        const localUnsettled = dynamicMetrics.filter(metric => replace.has(metric));
        let property = new Map([
            [
                "0:0",
                [zero()]
            ]
        ]);

        for (const categoryOptions of categories.values()) {
            const next = new Map(property);

            for (const frontier of property.values()) {
                for (const state of frontier) {
                    if (state.ids.length >= Math.min(limits.slots, limits.duplicates)) continue;

                    for (const option of categoryOptions) {
                        if (state.cost + option.cost <= limits.cost) {
                            putFrontier(next, merge(state, option), localUnsettled);
                        }
                    }
                }
            }

            property = next;
        }

        const next = new Map();

        for (const left of total.values()) {
            for (const a of left) {
                for (const right of property.values()) {
                    for (const b of right) {
                        if (a.ids.length + b.ids.length <= limits.slots && a.cost + b.cost <= limits.cost) {
                            putFrontier(next, merge(a, b), future);
                        }
                    }
                }
            }
        }

        total = next;
    }

    const value = state => criticalDamage(model, {
        power: model.stats.power + state.power,
        amplification: base + state.amplification + lowerDynamicAmplification(state),
        critical: model.stats[criticalStat] + state.critical + (state.effects.replacement[criticalStat]?.min || 0),
        piercing: (model.stats[piercingStat] || 0) + state.piercing,
        reduction: (model.stats[reductionStat] || 0) + state.reduction,
        damageBonus: Math.fround((model.damageBonus || 0) + state.damageBonus)
    });

    let best = initial;
    let bestValue = value(best);

    for (const frontier of total.values()) {
        for (const state of frontier) {
            const candidate = value(state);

            const defenseDifference = context.healerSupport ? state.primary - best.primary : 0;

            if (defenseDifference > EPSILON || Math.abs(defenseDifference) <= EPSILON && (candidate > bestValue + EPSILON || Math.abs(candidate - bestValue) <= EPSILON && compare(state, best) > 0)) {
                best = state;
                bestValue = candidate;
            }
        }
    }

    const baseline = value(initial);

    return {
        ...best,
        primary: best.primary - initial.primary,
        secondary: best.secondary - initial.secondary,
        damageScore: bestValue,
        damageGain: baseline > 0 ? bestValue / baseline - 1 : null,
        damageBonus: Math.fround(best.damageBonus - initial.damageBonus),
        conflicts: conflicts(best.effects)
    };
}

function planCombines(catalog, registered, active, limit, metrics, context) {
    const available = collectionPassives(catalog, registered);
    const deckEffect = effects(context.deckPassives || [], catalog, context);

    function evaluate(selected) {
        const passiveIds = selected.flatMap(combine => combine.passiveIds);
        const combinedEffect = mergeEffects(deckEffect, effects(passiveIds, catalog, context));
        const permanent = {};
        const proc = {};
        const groups = new Map();
        const procs = [];

        for (const metric of Object.keys(STATS)) {
            permanent[metric] = effectValue(combinedEffect, metric) - effectValue(deckEffect, metric);
            proc[metric] = 0;
        }

        for (const id of new Set(passiveIds)) {
            const passive = catalog.passives.get(id);

            // Numeric procs in the current collection sheets use 224 for critical hits.
            // Kill, resurrection and other event effects are excluded while the collection's permanent bonuses remain.
            if (!passive || passive.type !== TYPES.CRITICAL_HIT || passive.method !== PASSIVE_METHOD.SET_PERCENT || passive.prob <= 0 || passive.kind !== 0) continue;

            if (![0, 25].includes(passive.condition) || passive.conditionValue !== 0) continue;

            if (passive.species && (!context.useSpecies || passive.species !== context.species)) continue;

            if (passive.mobSize !== "all" && passive.mobSize !== context.size) continue;

            const abnormality = catalog.abnormalities.get(passive.value);

            if (!abnormality || abnormality.time <= 0) continue;

            const key = abnormality.kind || abnormality.id;

            if (!groups.has(key)) {
                groups.set(key, new Map());
            }

            if (groups.get(key).has(abnormality.id)) continue;

            groups.get(key).set(abnormality.id, abnormality);

            procs.push({
                id: abnormality.id,
                passiveId: id,
                probability: passive.prob,
                duration: abnormality.time
            });
        }

        // Same-kind buffs share one slot.
        // They may trigger in either order: count the lower bound once, preserving each list's permanent bonuses instead of rejecting an otherwise legal collection pair.
        for (const group of groups.values()) {
            for (const [metric, stat] of Object.entries(STATS)) {
                const types = context.healerSupport && metric === "magicalDefense" ? [1004] : stat.types;

                proc[metric] += Math.min(...Array.from(
                    group.values(),
                    abnormality => abnormality.effects.filter(effect => effect.method === ABNORMALITY_METHOD.ADD_ABSOLUTE && effect.tick === 0 && types.includes(effect.type))
                        .reduce(
                            (sum, effect) => sum + effect.value,
                            0
                        )
                ));
            }
        }

        const bonuses = Object.fromEntries(Object.keys(STATS).map(metric => [metric, effectValue(combinedEffect, metric) + proc[metric]]));
        const damageBonus = effectValue(combinedEffect, "damageBonus");

        if (damageBonus) {
            bonuses.damageBonus = damageBonus;
            permanent.damageBonus = damageBonus - effectValue(deckEffect, "damageBonus");
        }

        return {
            ...empty(),
            ids: selected.map(combine => combine.id),
            retained: selected.filter(combine => active.has(combine.id)).length,
            primary: (permanent[metrics[0]] || 0) + (proc[metrics[0]] || 0),
            secondary: (permanent[metrics[1]] || 0) + (proc[metrics[1]] || 0),
            permanent,
            proc,
            procs,
            bonuses,
            effects: combinedEffect,
            conflicts: conflicts(combinedEffect),
            procConflicts: Array.from(groups.values()).filter(group => group.size > 1).length,
            damageScore: context.damage ? damageValue(context.damage, bonuses) : null
        };
    }

    const better = (a, b) => {
        if (!a) return false;

        if (context.healerSupport) {
            const defenseDifference = a.permanent.magicalDefense + a.proc.magicalDefense - b.permanent.magicalDefense - b.proc.magicalDefense;

            if (Math.abs(defenseDifference) > EPSILON) return defenseDifference > 0;
        }

        if (context.damage) {
            if (Math.abs(a.damageScore - b.damageScore) > EPSILON) return a.damageScore > b.damageScore;
        }

        return compare(a, b) > 0;
    };

    let best = evaluate([]);
    const useful = available;

    // Collection effects are not independent: several lists reference the same passive/buff, and some buffs replace each other.
    // Compare complete sets.
    function visit(selected, start) {
        const value = evaluate(selected);

        if (!value) return;

        if (better(value, best)) {
            best = value;
        }

        if (selected.length >= limit) return;

        for (let index = start; index < useful.length; index++) {
            visit(selected.concat(useful[index]), index + 1);
        }
    }

    visit([], 0);

    return best;
}

module.exports = {
    score,
    compare,
    planDeck,
    planDamageDeck,
    planCombines,
    collectionPassives
};
