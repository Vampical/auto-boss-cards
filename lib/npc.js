"use strict";

const REVISION = 7;
const flag = value => value === true || value === 1 || /^(true|1)$/i.test(String(value));

function classify(attributes, confirmedBoss = false, variants = []) {
    if (!flag(attributes.showAggroTarget)) return null;

    const a = attributes;
    const service = [
        "villager",
        "isServant",
        "isObjectNpc",
        "isVehicleEx",
        "isHomunculus",
        "isSpirit"
    ];

    if (service.some(key => flag(a[key])) || /(^|_)(door|object|servant|vehicle)(_|$)/i.test(String(a.race || ""))) return null;

    const helper = flag(a.invincible) && Number(a.resourceSize) === 0 && !String(a.resourceType || "").trim() && !flag(a.showTargetInfo);

    if (helper) return null;

    const parent = Number(a.parentId);
    const actions = Number(a.basicActionId);
    const race = String(a.race || "").trim().toLowerCase();

    // Replica actors share an elite template's ancestry but use a different action set.
    if (!flag(a.elite) && flag(a.cameraPenetratable) && parent > 0 && actions > 0 && race && variants.some(peer =>
        flag(peer.elite) && !flag(peer.cameraPenetratable) && Number(peer.parentId) === parent &&
        String(peer.race || "").trim().toLowerCase() === race && Number(peer.basicActionId) > 0 && Number(peer.basicActionId) !== actions && classify(peer)))
        return null;

    return {
        size: String(attributes.size || "all").toLowerCase(),
        isBoss: confirmedBoss,
        isBam: !confirmedBoss
    };
}

function spawnHostility(event) {
    if (event.aggressive === undefined && event.relation === undefined && event.spawnType === undefined) return undefined;

    return flag(event.aggressive) || Number(event.relation) === 12 || Number(event.relation) === 10 && Number(event.spawnType) === 1;
}

module.exports = {
    REVISION,
    classify,
    spawnHostility
};
