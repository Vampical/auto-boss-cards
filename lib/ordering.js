"use strict";

const { effects, mergeEffects, value } = require("./effects");
const { damageValue } = require("./damage");
const { STATS } = require("./config");

function source(catalog, context, kind, id, passiveIds) {
    const effect = effects([], catalog, context);

    // Keep the last write within one item's own passive list.
    for (const passiveId of passiveIds) {
        const next = effects([passiveId], catalog, context);

        effect.additive = mergeEffects(effect, {
            additive: next.additive,
            replacement: {}
        }).additive;
        Object.assign(effect.replacement, next.replacement);
    }

    return {
        kind,
        id,
        effect
    };
}

function outcomes(sources) {
    const result = new Map();
    const dynamic = sources.filter(item => Object.keys(item.effect.replacement).length);

    // Several fields can belong to one item, so independent per-field maxima may be impossible.
    function visit(remaining, replacement, order) {
        if (!remaining.length) {
            const key = JSON.stringify(Object.entries(replacement).sort(([a], [b]) => a.localeCompare(b)));

            if (!result.has(key)) result.set(key, {
                replacement,
                order
            });

            return;
        }

        const seen = new Set();

        for (let index = 0; index < remaining.length; index++) {
            const item = remaining[index];
            const key = JSON.stringify(item.effect.replacement);

            if (seen.has(key)) continue;

            seen.add(key);
            visit(remaining.filter((_, i) => i !== index), {
                ...replacement,
                ...item.effect.replacement
            }, order.concat(item));
        }
    }

    visit(dynamic, {}, []);

    return [...result.values()];
}

function orderedEffect(sources) {
    const result = {
        additive: {},
        replacement: {}
    };

    for (const item of sources) {
        result.additive = mergeEffects(result, {
            additive: item.effect.additive,
            replacement: {}
        }).additive;
        Object.assign(result.replacement, item.effect.replacement);
    }

    return result;
}

function planOrdered(catalog, registered, equipped, active, limits, metrics, collectionMetrics, context, helpers) {
    const { collectionChoices, collectionPassives, planDeck, planDamageDeck, compare, compareLoadout } = helpers;
    const available = new Map(collectionPassives(catalog, registered).map(item => [item.id, item.passiveIds]));
    let choices = collectionChoices(catalog, registered, active, limits.combines, collectionMetrics, {
        ...context,
        deckPassives: [],
        damage: null
    });

    choices = choices.map(choice => {
        const sources = choice.ids.map(id => source(catalog, context, "collection", id, available.get(id)));
        const additive = orderedEffect(sources).additive;
        const amount = metric => (additive[metric] || 0) + (choice.proc[metric] || 0);
        const vector = context.optimizeDamage ? [
            amount("power"),
            context.damage.physical * amount("physicalAttack") + context.damage.magical * amount("magicalAttack"),
            amount(`${context.damage.type}CritPower`),
            amount(`${context.damage.type}Piercing`),
            amount(`${context.damage.type}DefenseReduction`),
            amount("damageBonus"),
            ...metrics.filter(Boolean).map(amount)
        ] : metrics.filter(Boolean).map(amount);

        const bestOrder = outcomes(sources).reduce((best, outcome) => {
            const metricValue = metric => amount(metric) + (outcome.replacement[metric]?.min || 0);
            const candidate = {
                ...choice,
                primary: metricValue(collectionMetrics[0]),
                secondary: metricValue(collectionMetrics[1])
            };

            return compare(candidate, best) > 0 ? candidate : best;
        }, null);

        return {
            ...bestOrder,
            sources,
            additive,
            vector
        };
    });

    if (!context.optimizeDamage && !context.collectionAuto && !context.healerSupport) {
        for (const key of ["primary", "secondary"]) {
            const maximum = Math.max(...choices.map(choice => choice[key]));

            choices = choices.filter(choice => Math.abs(choice[key] - maximum) <= 1e-9);
        }
    }

    const collectionFrontier = new Map();

    for (const choice of choices) {
        const key = JSON.stringify(choice.sources.map(item => item.effect.replacement).filter(item => Object.keys(item).length).map(item => JSON.stringify(item)).sort());
        const previous = collectionFrontier.get(key) || [];
        const dominates = (a, b) => a.vector.every((amount, index) => amount >= b.vector[index] - 1e-9) && compare({
            ...a,
            primary: 0,
            secondary: 0
        }, {
            ...b,
            primary: 0,
            secondary: 0
        }) >= 0;

        if (previous.some(other => dominates(other, choice))) continue;

        collectionFrontier.set(key, previous.filter(other => !dominates(choice, other)).concat(choice));
    }

    choices = [...collectionFrontier.values()].flat();

    const dynamic = [];
    const remaining = new Map(registered);

    for (const [id, amount] of registered) {
        const card = catalog.cards.get(id);

        if (!card || amount !== card.activation || !Number.isInteger(card.cost) || card.cost < 0 || card.cost > limits.cost) continue;

        const item = source(catalog, context, "card", id, card.passives);

        if (!Object.keys(item.effect.replacement).length) continue;

        remaining.delete(id);

        if (context.healerSupport && !(item.effect.additive.magicalDefense > 0)) continue;

        dynamic.push({
            ...item,
            card
        });
    }

    // Without a replacing card, one shared additive frontier still handles all collection choices.
    // Enumerate the small conditional part separately and reserve its real cost and property slots.
    let best = null;
    const frontierCache = new Map();

    function consider(selected) {
        const cost = selected.reduce((sum, item) => sum + item.card.cost, 0);
        const properties = new Map();
        const categories = new Set(selected.map(item => item.card.category));

        for (const item of selected) properties.set(item.card.property, (properties.get(item.card.property) || 0) + 1);

        const rest = new Map([...remaining].filter(([id]) => !categories.has(catalog.cards.get(id)?.category)));
        const virtual = [];

        for (const choice of choices) {
            const sources = selected.concat(choice.sources);
            const additive = mergeEffects(orderedEffect(selected), {
                additive: choice.additive,
                replacement: {}
            }).additive;

            for (const outcome of outcomes(sources)) {
                const effect = {
                    additive: { ...additive },
                    replacement: {}
                };

                for (const [metric, amount] of Object.entries(outcome.replacement)) effect.additive[metric] = (effect.additive[metric] || 0) + amount.min;

                for (const [metric, amount] of Object.entries(choice.proc)) effect.additive[metric] = (effect.additive[metric] || 0) + amount;

                virtual.push({
                    ...choice,
                    ids: choice.ids.slice(),
                    retained: choice.retained + selected.filter(item => equipped.has(item.id)).length,
                    effects: effect,
                    primary: value(effect, metrics[0]),
                    secondary: value(effect, metrics[1]),
                    original: choice,
                    sources,
                    outcome
                });
            }
        }

        const reserved = {
            ...limits,
            slots: limits.slots - selected.length,
            cost: limits.cost - cost
        };
        const nextContext = {
            ...context,
            reservedProperties: properties,
            frontierCache,
            fixedEffects: undefined,
            fixedPassives: []
        };

        function assemble(restDeck, chosen) {
            const order = chosen.outcome.order;
            const cardSources = order.filter(item => item.kind === "card").concat(selected.filter(item => !order.includes(item)));
            const cardEffects = orderedEffect(cardSources.concat(restDeck.ids.map(id => source(catalog, context, "card", id, catalog.cards.get(id).passives))));
            const whole = mergeEffects(effects(restDeck.ids.flatMap(id => catalog.cards.get(id).passives), catalog, context), chosen.effects);
            const bonuses = Object.fromEntries(Object.keys(STATS).map(metric => [metric, value(whole, metric)]));

            if (value(whole, "damageBonus")) bonuses.damageBonus = value(whole, "damageBonus");

            const permanent = Object.fromEntries(Object.keys(STATS).map(metric => [metric, bonuses[metric] - value(cardEffects, metric) - (chosen.original.proc[metric] || 0)]));
            const deck = {
                ...restDeck,
                ids: selected.map(item => item.id).concat(restDeck.ids),
                cost: cost + restDeck.cost,
                retained: selected.filter(item => equipped.has(item.id)).length + restDeck.retained,
                effects: cardEffects,
                primary: value(cardEffects, metrics[0]),
                secondary: value(cardEffects, metrics[1]),
                power: value(cardEffects, "power"),
                damageBonus: value(cardEffects, "damageBonus"),
                conflicts: [],
                damageScore: context.damage ? damageValue(context.damage, Object.fromEntries(Object.keys(STATS).concat("damageBonus").map(metric => [metric, value(cardEffects, metric)]))) : null
            };
            const combines = {
                ...chosen.original,
                effects: whole,
                permanent,
                bonuses,
                primary: (permanent[collectionMetrics[0]] || 0) + (chosen.original.proc[collectionMetrics[0]] || 0),
                secondary: (permanent[collectionMetrics[1]] || 0) + (chosen.original.proc[collectionMetrics[1]] || 0),
                conflicts: [],
                damageScore: context.damage ? damageValue(context.damage, bonuses) : null
            };
            const comparison = {
                ...combines,
                effects: {
                    additive: Object.fromEntries(Object.keys(STATS).map(metric => [metric, bonuses[metric] - value(cardEffects, metric)])),
                    replacement: {}
                }
            };
            let difference = context.healerSupport && best ? bonuses.magicalDefense - best.combines.bonuses.magicalDefense : 0;

            if (Math.abs(difference) <= 1e-9 && context.optimizeDamage && best) difference = combines.damageScore - best.combines.damageScore;

            if (!best || difference > 1e-9 || Math.abs(difference) <= 1e-9 && compareLoadout(deck, comparison, best.deck, best.comparison, metrics) > 0) {
                // Compare whole-set values directly; a collection can replace a card's conditional value.
                const writes = new Map();

                for (const item of chosen.sources) {
                    for (const [metric, amount] of Object.entries(item.effect.replacement)) {
                        if (!writes.has(metric)) writes.set(metric, new Set());

                        writes.get(metric).add(amount.min);
                    }
                }

                best = {
                    deck,
                    combines,
                    comparison,
                    applicationOrder: [...writes.values()].some(values => values.size > 1) ? order.map(({ kind, id }) => ({
                        kind,
                        id
                    })) : []
                };
            }
        }

        if (context.optimizeDamage) {
            const restDeck = planDamageDeck(catalog, rest, equipped, reserved, metrics, {
                ...nextContext,
                collections: virtual
            });

            assemble(restDeck, restDeck.collection);
        } else {
            for (const chosen of virtual) {
                assemble(planDeck(catalog, rest, equipped, reserved, metrics, {
                    ...nextContext,
                    fixedEffects: chosen.effects
                }), chosen);
            }
        }
    }

    function visit(selected, start, cost, categories, properties) {
        consider(selected);

        if (selected.length >= limits.slots) return;

        for (let index = start; index < dynamic.length; index++) {
            const item = dynamic[index];

            if (categories.has(item.card.category) || cost + item.card.cost > limits.cost || (properties.get(item.card.property) || 0) >= limits.duplicates) continue;

            visit(selected.concat(item), index + 1, cost + item.card.cost, new Set([...categories, item.card.category]), new Map(properties).set(item.card.property, (properties.get(item.card.property) || 0) + 1));
        }
    }

    visit([], 0, 0, new Set(), new Map());
    delete best.comparison;
    delete best.deck.collection;

    return best;
}

module.exports = { planOrdered };
