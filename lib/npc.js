"use strict";

// These are DataCenter role names, independent of the Toolbox UI language.
const BALANCE_TYPES = [
    "인던_네임드_보스",
    "인던_네임드_중형",
    "솔로_중형",
    "파티_중형",
    "파티_네임드_중형",
    "파티_자유사냥_네임드_중형"
];

const REVISION = 4;
const flag = value => value === true || value === 1 || /^(true|1)$/i.test(String(value));

function candidate(attributes, confirmedBoss = false) {
    if (!flag(attributes.showAggroTarget)) return null;

    if (confirmedBoss) return {
        isBoss: true,
        isBam: false,
        needsAttack: false
    };

    const a = attributes;

    // Invisible mechanic actors may attack and even carry a boss balance label.
    // Their invulnerability, missing resource bar and hidden target/aggro UI distinguish them from real combat targets.
    const invisibleActor = flag(a.invincible) && Number(a.resourceSize) === 0 && !String(a.resourceType || "").trim() && !flag(a.showTargetInfo) && !flag(a.showAggroTarget);

    if (invisibleActor) return null;

    const service = [
        "villager",
        "isServant",
        "isObjectNpc",
        "isVehicleEx",
        "isHomunculus",
        "isSpirit"
    ];

    if (service.some(key => flag(a[key])) || /(^|_)(door|object|servant|vehicle)(_|$)/i.test(String(a.race || ""))) return null;

    const role = String(a.balanceType || "").trim();
    const isBoss = /(^|_)(보스|boss)(_|$)/i.test(role) || flag(a.isFreeNamed);
    const isBam = /(^|_)(중형|bam)(_|$)/i.test(role);

    if (!isBoss && !isBam && String(a.size).toLowerCase() !== "large") return null;

    // Large is a damage-size category.
    // Without an explicit combat role, also require attacking skills.
    return {
        isBoss,
        isBam,
        needsAttack: !isBoss && !isBam
    };
}

function classify(attributes, confirmedBoss = false, hasAttack = false) {
    const role = candidate(attributes, confirmedBoss);

    if (!role || role.needsAttack && !hasAttack) return null;

    return {
        size: String(attributes.size || "all").toLowerCase(),
        isBoss: role.isBoss,
        isBam: role.isBam || role.needsAttack
    };
}

function spawnHostility(event) {
    if (event.aggressive === undefined && event.relation === undefined && event.spawnType === undefined) return undefined;

    return flag(event.aggressive) || Number(event.relation) === 12 || Number(event.relation) === 10 && Number(event.spawnType) === 1;
}

module.exports = {
    BALANCE_TYPES,
    REVISION,
    candidate,
    classify,
    spawnHostility
};
