"use strict";

const { text } = require("./i18n");

const npcTypes = require("./npc");

const { METHOD, TYPES } = require("./passivity");

function nodes(value) {
    if (Array.isArray(value)) return value;

    return value ? [value] : [];
}

function attrs(node) {
    return node.attributes || {};
}

function children(node, name) {
    return (node.children || []).filter(child => child.name === name);
}

function numbers(value) {
    return String(value || "").split(",").map(Number).filter(amount => Number.isInteger(amount) && amount > 0);
}

class Catalog {
    constructor(query, translate = (key, values) => text("en", key, values)) {
        this.query = query;
        this.t = translate;
        this.cards = new Map();
        this.passives = new Map();
        this.levels = new Map();
        this.combines = new Map();
        this.bosses = new Set();
        this.speciesNames = new Map();
        this.npcZones = new Map();
        this.npcClassificationRevision = npcTypes.REVISION;
        this.bossZones = new Map();
        this.abnormalities = new Map();
        this.ignoredProcIds = new Set();
        this.collectionEffectRevision = 3;
        this.skillProfiles = new Map();
        this.loaded = false;
        this.promise = null;
    }

    load() {
        if (this.loaded) return Promise.resolve(this);

        if (!this.promise) {
            this.promise = this._load().catch(error => {
                this.promise = null;

                throw error;
            });
        }

        return this.promise;
    }

    async _load() {
        // Same queryData API and attribute filtering as tera-core.datacenter.
        const tasks = [
            [
                "/CardTemplateData/CardTemplate",
                [],
                true,
                true,
                [
                    "id",
                    "category",
                    "property",
                    "level",
                    "cost",
                    "needAmountForActivation"
                ]
            ],
            [
                "/CollectionBook/BookTypeList@type=?/BookLevelData/LevelData",
                ["card"],
                true,
                false,
                [
                    "level",
                    "maxCost",
                    "equipableCardAmount",
                    "duplicateEquipableCardPropertyAmount",
                    "combineListSelectAmount"
                ]
            ],
            [
                "/CardCombineList/CombineList",
                [],
                true,
                true,
                ["id", "cardCategory", "allCardMinLevel"]
            ]
        ];

        // Keep client requests sequential; older interfaces serialize DC queries.
        const result = [];

        for (const task of tasks) {
            result.push(nodes(await this.query(...task)));
        }

        const passiveIds = new Set();

        for (const node of result[0]) {
            for (const parent of children(node, "CardPassive")) {
                for (const child of children(parent, "Passivity")) {
                    passiveIds.add(Number(attrs(child).id));
                }
            }
        }

        for (const node of result[2]) {
            for (const child of node.children || []) {
                if (["BasePassivity", "BonusPassivity"].includes(child.name)) {
                    passiveIds.add(Number(attrs(child).id));
                }
            }
        }

        const ids = Array.from(passiveIds);
        const passives = [];

        for (let i = 0; i < ids.length; i += 400) {
            passives.push(...nodes(await this.query(
                "/Passivity/Passive@id=?",
                [ids.slice(i, i + 400)],
                true,
                false,
                [
                    "id",
                    "kind",
                    "method",
                    "type",
                    "value",
                    "condition",
                    "conditionValue",
                    "targetSpeciesId",
                    "mobSize",
                    "prob"
                ]
            )));
        }

        this.importData(result[0], passives, result[1], result[2]);

        const procIds = Array.from(new Set(
            Array.from(this.passives.values())
                .filter(passive => passive.type === TYPES.CRITICAL_HIT && passive.method === METHOD.SET_PERCENT && passive.prob > 0)
                .map(passive => passive.value)
        ));

        const effectIds = Array.from(new Set([...procIds, ...this.ignoredProcIds]));

        if (effectIds.length) {
            // Read kill/resurrection buffs too so an already-active one can be removed from live stats without valuing it as a proposed proc.
            this.importAbnormalities(nodes(
                await this.query(
                    "/Abnormality/Abnormal@id=?",
                    [effectIds],
                    true,
                    true,
                    [
                        "id",
                        "kind",
                        "level",
                        "time",
                        "type",
                        "method",
                        "value",
                        "tickInterval"
                    ]
                )
            ));

            if (procIds.some(id => !this.abnormalities.has(id))) throw new Error(this.t("missingProcData"));
        }

        if (!this.cards.size || !this.levels.size || !this.passives.size) throw new Error(this.t("missingCardData"));

        if (ids.some(id => !this.passives.has(id))) throw new Error(this.t("missingPassives"));

        for (const card of this.cards.values()) {
            if (![card.id, card.category, card.property, card.activation].every(value => Number.isInteger(value) && value > 0) || !Number.isInteger(card.cost) || card.cost < 0 || !Number.isInteger(card.level) || card.level < 0) {
                throw new Error(this.t("invalidCard", {
                    id: card.id
                }));
            }
        }

        for (const limits of this.levels.values()) {
            if (![limits.slots, limits.cost, limits.duplicates].every(value => Number.isInteger(value) && value > 0) || !Number.isInteger(limits.combines) || limits.combines < 0)
                throw new Error(this.t("invalidLimits"));
        }

        for (const [query, destination, key, value] of [
            ["/BossGage/BossList/Boss", this.bosses, null, null],
            ["/StrSheet_Species/String", this.speciesNames, "id", "name"]
        ]) {
            try {
                for (const node of nodes(await this.query(query, [], true, false))) {
                    const a = attrs(node);

                    if (destination instanceof Set) {
                        const zone = Number(a.huntingZoneId);
                        const id = Number(a.templateId);

                        destination.add(`${zone}:${id}`);

                        if (!this.bossZones.has(zone)) {
                            this.bossZones.set(zone, new Set());
                        }

                        this.bossZones.get(zone).add(id);
                    } else {
                        destination.set(Number(a[key]), String(a[value] || a[key]));
                    }
                }
            } catch (_) {}
        }

        this.loaded = true;

        return this;
    }

    importAbnormalities(abnormalNodes) {
        this.abnormalities.clear();

        for (const node of abnormalNodes) {
            const a = attrs(node);

            this.abnormalities.set(Number(a.id), {
                id: Number(a.id),
                kind: Number(a.kind),
                level: Number(a.level),
                time: Number(a.time),
                effects: children(node, "AbnormalityEffect").map(child => {
                    const effect = attrs(child);

                    return {
                        type: Number(effect.type),
                        method: Number(effect.method),
                        value: Number(effect.value),
                        tick: Number(effect.tickInterval || 0)
                    };
                })
            });
        }
    }

    damageSkills(templateId) {
        if (!this.skillProfiles.has(templateId)) {
            const promise = this.query(
                "/SkillData@huntingZoneId=?/Skill@templateId=?",
                [0, templateId],
                true,
                false,
                [
                    "id",
                    "skillDamageType",
                    "physicalFactor",
                    "magicalFactor",
                    "totalAtk"
                ]
            ).then(result => nodes(result).map(node => ({
                id: Number(attrs(node).id),
                type: String(attrs(node).skillDamageType || "").toLowerCase(),
                physical: Number(attrs(node).physicalFactor ?? 1),
                magical: Number(attrs(node).magicalFactor ?? 1),
                basePower: Number(attrs(node).totalAtk ?? 0)
            }))).catch(error => {
                this.skillProfiles.delete(templateId);

                throw error;
            });

            this.skillProfiles.set(templateId, promise);
        }

        return this.skillProfiles.get(templateId);
    }

    importData(cardNodes, passiveNodes, levelNodes, combineNodes) {
        this.cards.clear();
        this.passives.clear();
        this.levels.clear();
        this.combines.clear();

        for (const node of cardNodes) {
            const a = attrs(node);

            this.cards.set(Number(a.id), {
                id: Number(a.id),
                category: Number(a.category),
                property: Number(a.property),
                level: Number(a.level),
                cost: Number(a.cost),
                activation: Number(a.needAmountForActivation),
                passives: children(
                    node,
                    "CardPassive"
                )
                    .flatMap(parent => children(
                        parent,
                        "Passivity"
                    )
                        .map(child => Number(attrs(child)
                            .id)))
            });
        }

        for (const node of passiveNodes) {
            const a = attrs(node);

            this.passives.set(Number(a.id), {
                id: Number(a.id),
                kind: Number(a.kind || 0),
                method: Number(a.method),

                // Normalize this collection trigger to the on-kill event.
                type: Number(a.type) === TYPES.CLIENT_COLLECTION_TRIGGER ? TYPES.AFTER_DEFEATING_AN_ENEMY : Number(a.type),
                value: Number(a.value),
                condition: Number(a.condition || 0),
                conditionValue: Number(a.conditionValue || 0),
                species: Number(a.targetSpeciesId || 0),
                mobSize: String(a.mobSize || "all").toLowerCase(),
                prob: Number(a.prob ?? 1)
            });
        }

        this.ignoredProcIds = new Set(Array.from(this.passives.values())
            .filter(passive => [TYPES.AFTER_DEFEATING_AN_ENEMY, TYPES.AFTER_A_RESURRECTION].includes(passive.type) && passive.prob > 0)
            .map(passive => passive.value));

        for (const node of levelNodes) {
            const a = attrs(node);

            this.levels.set(Number(a.level), {
                slots: Number(a.equipableCardAmount),
                cost: Number(a.maxCost),
                duplicates: Number(a.duplicateEquipableCardPropertyAmount),
                combines: Number(a.combineListSelectAmount)
            });
        }

        for (const node of combineNodes) {
            const a = attrs(node);

            this.combines.set(Number(a.id), {
                id: Number(a.id),
                categories: numbers(a.cardCategory),
                passives: (node.children || []).filter(child => ["BasePassivity", "BonusPassivity"].includes(child.name)).map(child => ({
                    id: Number(attrs(child).id),
                    minLevel: Number(attrs(child).allCardMinLevel || 0)
                }))
            });
        }
    }

    async npc(zoneId, templateId, confirmedBoss = false) {
        const zone = Number(zoneId);
        const id = Number(templateId);

        if (confirmedBoss && !this.bosses.has(`${zone}:${id}`)) {
            this.bosses.add(`${zone}:${id}`);

            if (!this.bossZones.has(zone)) {
                this.bossZones.set(zone, new Set());
            }

            this.bossZones.get(zone).add(id);
            this.npcZones.delete(zone);
        }

        if (!this.npcZones.has(zone)) {
            const promise = this._loadZone(zone).catch(error => {
                this.npcZones.delete(zone);

                throw error;
            });

            this.npcZones.set(zone, promise);

            if (this.npcZones.size > 8) {
                this.npcZones.delete(this.npcZones.keys().next().value);
            }
        }

        const templates = await this.npcZones.get(zone);
        const template = templates.get(id);

        if (!template) return null;

        return template;
    }

    async _loadZone(zone) {
        const filter = [
            "id",
            "speciesId",
            "size",
            "resourceSize",
            "resourceType",
            "invincible",
            "showTargetInfo",
            "balanceType",
            "elite",
            "showAggroTarget",
            "race",
            "parentId",
            "isFreeNamed",
            "villager",
            "isServant",
            "isObjectNpc",
            "isVehicleEx",
            "isHomunculus",
            "isSpirit"
        ];

        const templates = new Map();
        const candidates = new Map();

        const queries = [
            [
                "/NpcData@huntingZoneId=?/Template@size=?",
                [zone, "large"]
            ],
            [
                "/NpcData@huntingZoneId=?/Template@balanceType=?",
                [zone, npcTypes.BALANCE_TYPES]
            ],
            [
                "/NpcData@huntingZoneId=?/Template@isFreeNamed=?",
                [zone, true]
            ]
        ];

        const bossIds = Array.from(this.bossZones.get(zone) || []);

        if (bossIds.length) {
            queries.push([
                "/NpcData@huntingZoneId=?/Template@id=?",
                [zone, bossIds]
            ]);
        }

        for (const [query, args] of queries) {
            for (const node of nodes(await this.query(query, args, true, false, filter))) {
                const a = attrs(node);
                const id = Number(a.id);
                const confirmed = this.bosses.has(`${zone}:${id}`);
                const role = npcTypes.candidate(a, confirmed);

                if (role) {
                    candidates.set(id, {
                        attributes: a,
                        confirmed,
                        role
                    });
                }
            }
        }

        const uncertain = [...candidates].filter(([, npc]) => npc.role.needsAttack);
        const attacks = await this.npcAttacks(zone, uncertain.map(([id]) => id));

        // The common NPC skill templates live in zone 1000.
        // Only consult them when the child has no skill entries; an explicit non-damaging list wins.
        const parentIds = [
            ...new Set(uncertain.filter(([id, npc]) => !attacks.has(id) && Number(npc.attributes.parentId) > 0)
                .map(([, npc]) => Number(npc.attributes.parentId)))
        ];

        const parents = zone === 1000 ? new Map() : await this.npcAttacks(1000, parentIds);

        for (const [id, npc] of candidates) {
            const hasAttack = attacks.has(id) ? attacks.get(id) : parents.get(Number(npc.attributes.parentId));
            const type = npcTypes.classify(npc.attributes, npc.confirmed, Boolean(hasAttack));

            if (type) {
                templates.set(id, {
                    ...type,
                    species: Number(npc.attributes.speciesId || 0)
                });
            }
        }

        return templates;
    }

    async npcAttacks(zone, ids) {
        const result = new Map();

        for (let offset = 0; offset < ids.length; offset += 100) {
            const skills = nodes(
                await this.query(
                    "/SkillData@huntingZoneId=?/Skill@templateId=?",
                    [
                        zone, ids.slice(
                            offset,
                            offset + 100
                        )
                    ],
                    true,
                    false,
                    ["templateId", "totalAtk"]
                )
            );

            for (const skill of skills) {
                const a = attrs(skill);
                const id = Number(a.templateId);

                result.set(id, Boolean(result.get(id)) || Number(a.totalAtk) > 0);
            }
        }

        // Some common NPC skills deliberately have totalAtk=0 in the client, while their targeting effect still declares an attack coefficient.
        for (const [id, attack] of result) {
            if (attack) continue;

            const effects = nodes(
                await this.query(
                    "/SkillData@huntingZoneId=?/Skill@templateId=?/TargetingList/Targeting/AreaList/Area/Effect",
                    [zone, id],
                    true,
                    false,
                    ["atk"]
                )
            );

            if (effects.some(effect => Number(attrs(effect).atk) > 0)) {
                result.set(id, true);
            }
        }

        return result;
    }
}

module.exports = {
    Catalog,
    nodes
};
