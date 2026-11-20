"use strict";

const { Catalog } = require("./lib/catalog");

const settings = require("./lib/config");
const protocol = require("./lib/protocol");

const { spawnHostility } = require("./lib/npc");

const { score, planDeck, planDamageDeck, planCombines, collectionPassives } = require("./lib/planner");

const damage = require("./lib/damage");

const { METHOD: ABNORMALITY_METHOD } = require("./lib/abnormality");

const { REPLACEMENTS, staticScore } = require("./lib/effects");

const { TYPES: PASSIVITY_TYPES } = require("./lib/passivity");

const { NAME, toolboxLanguage, text, statName, settingsStructure } = require("./lib/i18n");

const READ_REAL = {
    order: 1000,
    filter: {
        fake: false,
        modified: null,
        silenced: null
    }
};

const COMMANDS = ["bcards", "bosscards"];

class ClientMod {
    constructor(mod) {
        this.mod = mod;
        this.language = toolboxLanguage();
        const t = (key, values) => text(this.language, key, values);

        this.catalog = new Catalog((...args) => mod.queryData(...args), t);

        this.onReady = () => this.catalog.load().catch(error => mod.error(t("datacenterError", {
            error: error.message || error
        })));

        mod.clientInterface.once("ready", this.onReady);
    }

    saveState() {
        return this.catalog.loaded ? {
            catalog: this.catalog
        } : null;
    }

    loadState(state) {
        if (!state?.catalog?.loaded) return;

        if (!state.catalog.abnormalities || !state.catalog.ignoredProcIds) return;

        if (state.catalog.collectionEffectRevision !== this.catalog.collectionEffectRevision) return;

        for (const key of [
            "cards",
            "passives",
            "levels",
            "combines",
            "bosses",
            "bossZones",
            "speciesNames",
            "abnormalities",
            "ignoredProcIds",
            "skillProfiles",
            "loaded"
        ]) {
            if (state.catalog[key] !== undefined) {
                this.catalog[key] = state.catalog[key];
            }
        }

        if (state.catalog.npcClassificationRevision === this.catalog.npcClassificationRevision) {
            this.catalog.npcZones = state.catalog.npcZones;
        }

        this.catalog.promise = Promise.resolve(this.catalog);
    }

    destructor() {
        this.mod.clientInterface.removeListener("ready", this.onReady);
    }
}

class NetworkMod {
    constructor(mod) {
        this.mod = mod;
        this.language = toolboxLanguage();
        this.catalog = mod.clientMod.catalog;
        mod.settings = settings.normalize(mod.settings);
        this.destroyed = false;
        this.gui = null;
        this.hooks = [];
        this.timer = null;
        this.pending = null;
        this.epoch = 0;
        this.reset();

        if (mod.majorPatchVersion < 92 || mod.majorPatchVersion > 100) {
            mod.error(this.t("unsupportedClient"));

            return;
        }

        protocol.install(mod);
        this.installHooks();

        mod.command.add(COMMANDS, {
            $default: () => this.showGui(),
            ui: () => this.showGui(),
            on: () => this.updateSettings({
                ...mod.settings,
                enabled: true
            }),
            off: () => this.updateSettings({
                ...mod.settings,
                enabled: false
            }),
            status: () => this.message(this.status()),
            refresh: () => {
                this.requestSelection();
                this.cardsReady = false;
                this.combinesReady = false;
                this.requestSnapshots(true);
            },
            apply: () => this.requestSelection(),
            preview: () => this.preview(),
            help: () => this.message(this.t("help"))
        });

        const game = mod.game;

        if (game?.me?.gameId) {
            this.me = {
                gameId: game.me.gameId,
                templateId: game.me.templateId,
                job: game.me.templateId % 100 - 1,
                alive: game.me.alive,
                status: game.me.status,
                loc: null
            };

            this.loading = Boolean(game.isInLoadingScreen);
            this.requestSnapshots();
            this.loadDamageSkills();
        }

        this.catalog.load().then(async () => {
            if (this.destroyed) return;

            const epoch = this.epoch;

            this.debug(this.t("catalogLoaded", {
                cards: this.catalog.cards.size,
                collections: this.catalog.combines.size,
                bosses: this.catalog.bosses.size
            }));

            this.captureStatLoadout();
            await Promise.all([...this.mobs.values()].filter(mob => mob.hostile !== false || mob.rank === 3)
                .map(mob => this.inspectMob(
                    mob,
                    mob.rank === 3,
                    false
                )));

            if (this.destroyed || this.epoch !== epoch) return;

            if (!this.isEligible(this.target)) {
                this.chooseTarget();
            }

            this.schedule();
        }).catch(error => this.message(this.t("datacenterError", {
            error: error.message || error
        })));
    }

    reset() {
        this.cancelTimers();
        this.epoch++;

        this.me = {
            gameId: null,
            job: -1,
            alive: false,
            status: 0,
            loc: null
        };

        this.loading = true;
        this.lifeEpoch = 0;
        this.revivalPending = false;
        this.registered = new Map();
        this.presets = new Map();
        this.currentPreset = 0;
        this.collectionLevel = 0;
        this.activeCombines = new Set();
        this.cardsReady = false;
        this.combinesReady = false;
        this.mobs = new Map();
        this.goneMobs = new Set();
        this.target = null;
        this.selectionPending = false;
        this.selectionPlan = null;
        this.playerStats = null;
        this.statSources = null;
        this.damageSkills = [];
        this.learnedSkillRanks = null;
        this.activeProcBuffs = new Set();
        this.blocked = false;
        this.lastNotice = "";
        this.lastSnapshotRequest = 0;
        this.lastMovementCheck = 0;
    }

    hook(name, version, callback, optional = false) {
        try {
            this.hooks.push(this.mod.hook(name, version, READ_REAL, callback));
        } catch (error) {
            if (!optional) throw error;

            this.debug(this.t("optionalPacketMissing", {
                name,
                error: error.message
            }));
        }
    }

    installHooks() {
        this.hook("S_LOGIN", "*", event => {
            this.reset();

            this.me = {
                gameId: event.gameId,
                templateId: event.templateId,
                job: event.templateId % 100 - 1,
                alive: event.alive,
                status: event.status,
                loc: null
            };

            this.loadDamageSkills();
        });

        this.hook("S_RETURN_TO_LOBBY", "event", () => this.reset());

        this.hook("S_SKILL_LIST", 2, event => {
            if (this.me.gameId === null) return;

            this.learnedSkillRanks = damage.skillRanks(event.skills, this.learnedSkillRanks);
            this.schedule();
        });

        this.hook("S_LOAD_TOPO", "event", () => {
            if (this.pending) {
                this.cardsReady = false;
                this.combinesReady = false;
            }

            this.cancelTimers();
            this.epoch++;
            this.loading = true;
            this.me.loc = null;
            this.mobs.clear();
            this.goneMobs.clear();
            this.target = null;
            this.selectionPending = false;
            this.selectionPlan = null;
            this.blocked = false;
            this.lastNotice = "";
            this.lastSnapshotRequest = 0;
        });

        this.hook("S_SPAWN_ME", 3, event => {
            const wasLoading = this.loading;
            const wasAlive = this.me.alive;
            const wasReviving = this.revivalPending;

            this.loading = false;
            this.me.loc = event.loc;
            this.setAlive(event.alive);
            this.revivalPending = !event.alive;

            if (!this.cardsReady || !this.combinesReady) {
                this.requestSnapshots(true);
            }

            if (!this.damageSkills.length) {
                this.loadDamageSkills();
            }

            if (wasLoading) {
                for (const mob of this.mobs.values()) {
                    if (!mob.npc) {
                        this.inspectMob(mob);
                    }
                }
            }

            if (wasLoading || !this.target) {
                this.chooseTarget(wasAlive && !wasReviving);
            }

            this.schedule();
        });

        this.hook("S_USER_STATUS", 3, event => {
            if (!this.isMe(event.gameId)) return;

            const previous = this.me.status;

            this.me.status = event.status;

            if (previous === 1 && event.status !== 1) {
                this.blocked = false;
            }

            this.schedule();
        });

        this.hook("S_CREATURE_LIFE", 3, event => {
            if (this.isMe(event.gameId)) {
                this.setAlive(event.alive);

                if (event.alive && (!this.cardsReady || !this.combinesReady)) {
                    this.requestSnapshots(true);
                }

                this.schedule();
            } else if (!event.alive) {
                this.removeMob(event.gameId);
            }
        });

        this.hook("C_PLAYER_LOCATION", 5, event => {
            this.me.loc = event.loc;
        });

        this.hook("S_NPC_LOCATION", "*", event => {
            const mob = this.mobs.get(event.gameId);

            if (mob) {
                mob.loc = event.loc;
            }
        }, true);

        this.hook("S_SPAWN_NPC", "*", event => {
            if (event.status === 4) {
                this.removeMob(event.gameId);

                return;
            }

            if (event.villager || event.owner && event.owner !== 0n) return;

            this.goneMobs.delete(event.gameId);

            if (event.replaceId && event.replaceId !== 0n) {
                this.removeMob(event.replaceId);
            }

            const old = this.mobs.get(event.gameId);

            const mob = {
                ...old,
                gameId: event.gameId,
                zone: event.huntingZoneId,
                template: event.templateId,
                loc: event.loc,
                hostile: spawnHostility(event),
                npc: old && old.zone === event.huntingZoneId && old.template === event.templateId ? old.npc : null,
                rank: old?.rank || 1
            };

            this.mobs.set(mob.gameId, mob);

            if (this.target?.gameId === mob.gameId) {
                this.target = mob.npc ? mob : null;
            }

            if (mob.npc && !old?.loc && this.isEligible(mob)) {
                this.chooseTarget();
            }

            if (mob.hostile !== false || mob.rank === 3) {
                this.inspectMob(mob);
            } else if (this.target === mob) {
                this.chooseTarget();
            }
        });

        this.hook("S_DESPAWN_NPC", 3, event => this.removeMob(event.gameId));

        this.hook("S_BOSS_GAGE_INFO", 3, event => {
            if (BigInt(event.curHp) <= 0n) {
                this.removeMob(event.id);

                return;
            }

            this.gauge(event.id, event.huntingZoneId, event.templateId);
        });

        this.hook("S_BOSS_GAGE_STACK_INFO", 1, event => this.gauge(event.gameId, event.huntingZoneId, event.templateId));

        this.hook("S_CREATURE_CHANGE_HP", "*", event => {
            if (BigInt(event.curHp) <= 0n) {
                this.removeMob(event.target);
            }
        });

        this.hook("S_PLAYER_STAT_UPDATE", "*", event => {
            this.playerStats = damage.playerStats(event);

            this.statSources = {
                procs: [...this.activeProcBuffs]
            };

            this.captureStatLoadout();
            this.schedule();
        });

        for (const name of ["S_ABNORMALITY_BEGIN", "S_ABNORMALITY_REFRESH"]) {
            this.hook(name, "*", event => {
                if (this.isMe(event.target)) {
                    this.activeProcBuffs.add(event.id);
                }
            }, true);
        }

        this.hook("S_ABNORMALITY_END", "*", event => {
            if (this.isMe(event.target)) {
                this.activeProcBuffs.delete(event.id);
            }
        }, true);

        for (const name of [
            "C_MOUNT_CARD",
            "C_UNMOUNT_CARD",
            "C_ACTIVATE_CARD_COMBINE_LIST",
            "C_DEACTIVATE_CARD_COMBINE_LIST",
            "C_CHANGE_CARD_PRESET"
        ]) {
            this.hook(name, name === "C_CHANGE_CARD_PRESET" ? "event" : 1, () => {
                this.selectionPending = false;
                this.selectionPlan = null;
                this.clearSchedule();
            });
        }

        this.hook("S_CARD_DATA", 1, event => {
            if (!this.isMe(event.gameId)) return;

            this.registered = new Map(event.cards.map(card => [card.id, card.num]));
            this.presets = new Map(event.presets.map(preset => [preset.preset, new Set(preset.equippedCards.map(card => card.id))]));
            this.currentPreset = event.currentPreset;
            this.collectionLevel = event.collectionLevel;
            this.cardsReady = true;
            this.captureStatLoadout();
            this.confirmFromSnapshot();
            this.schedule();
        });

        this.hook("S_REGISTER_CARD", 1, event => {
            this.registered.set(event.id, event.num);
            this.schedule();
        });

        this.hook("S_CARD_COLLECTION_BOOK_LEVEL_UP", 1, event => {
            this.collectionLevel = event.collectionLevel;
            this.schedule();
        });

        this.hook("S_CHANGE_CARD_PRESET", 1, event => {
            const previous = this.currentPreset;

            this.currentPreset = event.preset;

            if (previous === event.preset || !this.cardsReady) return;

            this.lastNotice = "";
            this.selectionPending = false;
            this.selectionPlan = null;
            this.clearSchedule();
        });

        this.hook("S_CARD_DATA_RESET", 1, () => {
            this.cancelTimers();
            this.registered.clear();
            this.presets.clear();
            this.activeCombines.clear();
            this.cardsReady = false;
            this.combinesReady = false;
            this.requestSnapshots();
        });

        for (const [name, add] of [
            ["S_MOUNT_CARD", true],
            ["S_UNMOUNT_CARD", false]
        ]) {
            this.hook(name, 1, event => {
                if (!this.presets.has(event.preset)) {
                    this.presets.set(event.preset, new Set());
                }

                const cards = this.presets.get(event.preset);

                if (add) {
                    cards.add(event.id);
                } else {
                    cards.delete(event.id);
                }

                this.acknowledge(name, event);
                this.schedule();
            });
        }

        this.hook("S_ACTIVATE_CARD_COMBINE_LIST_DATA", 1, event => {
            if (!this.isMe(event.gameId)) return;

            this.activeCombines = new Set(event.combineList.map(combine => combine.id));
            this.combinesReady = true;
            this.captureStatLoadout();
            this.confirmFromSnapshot();
            this.schedule();
        });

        for (const [name, add] of [
            ["S_ACTIVATE_CARD_COMBINE_LIST", true],
            ["S_DEACTIVATE_CARD_COMBINE_LIST", false]
        ]) {
            this.hook(name, 1, event => {
                if (add) {
                    this.activeCombines.add(event.id);
                } else {
                    this.activeCombines.delete(event.id);
                }

                this.acknowledge(name, event);
                this.schedule();
            });
        }
    }

    isMe(id) {
        return this.me.gameId !== null && id === this.me.gameId;
    }

    setAlive(alive) {
        this.me.alive = alive;

        if (alive) return;

        this.lifeEpoch++;
        this.revivalPending = true;
        this.selectionPending = false;
        this.selectionPlan = null;

        if (this.pending) {
            this.cardsReady = false;
            this.combinesReady = false;
        }

        this.cancelTimers();
    }

    async loadDamageSkills() {
        const epoch = this.epoch;
        const templateId = this.me.templateId;

        if (!templateId) return;

        try {
            const skills = await this.catalog.damageSkills(templateId);

            if (this.destroyed || epoch !== this.epoch || templateId !== this.me.templateId) return;

            this.damageSkills = skills;
            this.schedule();
        } catch (error) {
            this.debug(`SkillData ${templateId}: ${error.message || error}`);
        }
    }

    requestSelection(allowed = true) {
        this.selectionPending = Boolean(allowed && this.target && this.me.alive);
        this.selectionPlan = null;
        this.blocked = false;
        this.lastNotice = "";
        this.schedule();
    }

    async inspectMob(mob, confirmedBoss = mob.rank === 3, reselect = true) {
        if (!this.catalog.loaded || mob.hostile === false && !confirmedBoss) return;

        const epoch = this.epoch;
        const lifeEpoch = this.lifeEpoch;
        const wasAlive = this.me.alive;

        try {
            const npc = await this.catalog.npc(mob.zone, mob.template, confirmedBoss);

            if (this.destroyed || epoch !== this.epoch || this.mobs.get(mob.gameId) !== mob) return;

            const wasEligible = this.isEligible(mob);

            mob.npc = npc;

            if (reselect && (wasEligible !== this.isEligible(mob) || this.target === mob && !this.isEligible(mob))) {
                this.chooseTarget(wasAlive && lifeEpoch === this.lifeEpoch);
            }
        } catch (error) {
            this.debug(`NpcData ${mob.zone}:${mob.template}: ${error.message || error}`);
        }
    }

    gauge(gameId, zone, template) {
        if (this.goneMobs.has(gameId)) return;

        let mob = this.mobs.get(gameId);

        if (!mob) {
            mob = {
                gameId,
                zone,
                template,
                loc: null,
                rank: 3,
                npc: null
            };

            this.mobs.set(gameId, mob);
        }

        const wasSelectable = this.canTarget(mob);

        mob.rank = 3;

        if (!wasSelectable && this.canTarget(mob) && this.target?.gameId !== gameId) {
            this.chooseTarget();
        }

        if (!mob.npc || !mob.npc.isBoss) {
            this.inspectMob(mob, true);
        }
    }

    distance(mob) {
        if (!mob.loc || !this.me.loc) return Infinity;

        return Math.hypot(mob.loc.x - this.me.loc.x, mob.loc.y - this.me.loc.y, mob.loc.z - this.me.loc.z);
    }

    isEligible(mob) {
        return Boolean(mob?.npc && (mob.hostile !== false || mob.rank === 3) && (mob.npc.isBoss || this.mod.settings.includeBams && mob.npc.isBam));
    }

    canTarget(mob) {
        const config = this.mod.settings;

        return this.isEligible(mob) && (mob.rank === 3 || config.detectOnSpawn && this.distance(mob) <= config.detectionRange * 100);
    }

    chooseTarget(allowed = true) {
        let best = null;

        for (const mob of this.mobs.values()) {
            if (!this.canTarget(mob)) continue;

            if (!best || this.distance(mob) < this.distance(best)) {
                best = mob;
            }
        }

        if (best?.gameId === this.target?.gameId) return;

        this.target = best;
        this.requestSelection(allowed);

        if (best) {
            this.debug(this.t("targetDebug", {
                zone: best.zone,
                template: best.template,
                species: best.npc.species,
                kind: best.npc.isBoss ? "boss" : "BAM",
                rank: best.rank
            }));
        }
    }

    removeMob(id) {
        const wasEligible = this.isEligible(this.mobs.get(id));

        this.goneMobs.add(id);

        if (this.goneMobs.size > 4096) {
            this.goneMobs.delete(this.goneMobs.values().next().value);
        }

        this.mobs.delete(id);

        if (this.target?.gameId === id) {
            this.target = null;
            this.selectionPending = false;
            this.selectionPlan = null;
        }

        if (wasEligible) {
            this.chooseTarget();
        }
    }

    requestSnapshots(force = false) {
        if (this.me.gameId === null || this.loading || !force && Date.now() - this.lastSnapshotRequest < 1500) return;

        this.lastSnapshotRequest = Date.now();

        try {
            this.mod.send("C_REQUEST_OTHERS_CARD_DATA_WITH_GAMEID", 1, {
                gameId: this.me.gameId
            });

            this.mod.send("C_REQUEST_MY_ACTIVATE_CARD_COMBINE_LIST_DATA", 1, {});
        } catch (error) {
            this.message(this.t("snapshotError", {
                error: error.message
            }));
        }
    }

    activeCollectionPassives() {
        return collectionPassives(
            this.catalog,
            this.registered
        )
            .filter(combine => this.activeCombines.has(combine.id))
            .flatMap(combine => combine.passiveIds);
    }

    captureStatLoadout() {
        if (!this.statSources || !this.cardsReady) return;

        const equipped = this.presets.get(this.currentPreset);

        if (!this.statSources.cards && equipped) {
            this.statSources.cards = [...equipped];
        }

        if (!this.statSources.combines && this.combinesReady && this.catalog.loaded) {
            this.statSources.combines = this.activeCollectionPassives();
        }
    }

    plan() {
        if (!this.catalog.loaded || !this.isEligible(this.target) || this.mobs.get(this.target.gameId) !== this.target || !this.cardsReady) return null;

        const limits = this.catalog.levels.get(this.collectionLevel);
        const metrics = settings.priorities(this.mod.settings, this.me.job);

        if (!limits || !metrics[0] || !this.presets.has(this.currentPreset)) return null;

        const healer = [6, 7].includes(this.me.job);
        const healerSupport = healer && metrics[0] === "magicalDefense";
        const healerCrit = healer && metrics[0] === "magicalCritPower";

        if (healerCrit) {
            metrics[1] = null;
        }

        const context = {
            ...this.target.npc,
            useSpecies: this.mod.settings.useSpecies,
            healerSupport
        };

        const collectionMetrics = healerSupport || healerCrit ? [metrics[0], healerCrit ? null : metrics[1]] : settings.collectionPriorities(
            this.mod.settings,
            metrics
        );
        const equipped = this.presets.get(this.currentPreset);

        context.fixedPassives = this.mod.settings.manageCombines ? [] : this.activeCollectionPassives()
            .filter(id => REPLACEMENTS[this.catalog.passives.get(id)?.type] || this.catalog.passives.get(id)?.type === PASSIVITY_TYPES.DAMAGE);

        // Unknown equipped IDs must not be silently removed on a mismatched DC.
        if (Array.from(equipped)
            .some(id => !this.catalog.cards.has(id) || this.registered.get(id) !== this.catalog.cards.get(id)
                .activation))
            return null;

        const offensive = /^(physical|magical)(CritPower|Attack|Piercing|DefenseReduction)$/.test(metrics[0]);
        const powerMode = this.mod.settings.optimizePower && (offensive || healerSupport);
        const damageMode = healerSupport && powerMode || !healer && this.mod.settings.collectionPriority === "cards" && offensive;

        if (powerMode || this.mod.settings.manageCombines && damageMode) {
            context.damage = damage.profile(this.playerStats, this.damageSkills, metrics[0], this.learnedSkillRanks);
            const sources = this.statSources;

            if (!context.damage || powerMode && (!damage.DAMAGE_STATS.every(key => Number.isFinite(context.damage.stats[key])) || !Number.isFinite(this.playerStats.genericCritical)) || !sources?.cards || this.mod.settings.manageCombines && (!this.combinesReady || !sources.combines))
                return null;

            // Rebase against the loadout and procs captured with the stat update.
            // A respawn can arrive between a state change and the next stat packet.
            const oldCards = sources.cards.flatMap(id => this.catalog.cards.get(id)?.passives || []);

            const oldCombines = sources.combines;

            if (sources.procs.some(id => this.catalog.ignoredProcIds.has(id) && !this.catalog.abnormalities.has(id))) return null;

            const oldProcs = sources.procs.filter(id => this.mod.settings.manageCombines || this.catalog.ignoredProcIds.has(id));

            for (const stat of Object.keys(context.damage.stats)) {
                context.damage.stats[stat] -= staticScore(
                    oldCards,
                    this.catalog,
                    stat,
                    context
                ) + (this.mod.settings.manageCombines ? staticScore(
                    oldCombines,
                    this.catalog,
                    stat,
                    context
                ) : 0);

                for (const id of oldProcs) {
                    for (const effect of this.catalog.abnormalities.get(id)?.effects || []) {
                        if (effect.method === ABNORMALITY_METHOD.ADD_ABSOLUTE && effect.tick === 0 && settings.STATS[stat].types.includes(effect.type)) {
                            context.damage.stats[stat] -= effect.value;
                        }
                    }
                }
            }
        }

        const deck = powerMode ? planDamageDeck(
            this.catalog,
            this.registered,
            equipped,
            limits,
            metrics,
            context
        ) : planDeck(
            this.catalog,
            this.registered,
            equipped,
            limits,
            metrics,
            context
        );

        context.deckPassives = deck.ids.flatMap(id => this.catalog.cards.get(id).passives);

        const combines = this.mod.settings.manageCombines && this.combinesReady ? planCombines(this.catalog, this.registered, this.activeCombines, limits.combines, collectionMetrics, {
            ...context,
            damage: damageMode ? context.damage : null
        }) : null;

        return {
            deck,
            combines,
            metrics,
            collectionMetrics,
            limits,
            damageMode,
            powerMode,
            healerSupport,
            healerCrit
        };
    }

    nextOperation(plan) {
        const wanted = new Set(plan.deck.ids);
        const equipped = this.presets.get(this.currentPreset);

        for (const id of equipped) {
            if (!wanted.has(id)) return {
                request: "C_UNMOUNT_CARD",
                reply: "S_UNMOUNT_CARD",
                id,
                preset: this.currentPreset
            };
        }

        for (const id of wanted) {
            if (!equipped.has(id)) return {
                request: "C_MOUNT_CARD",
                reply: "S_MOUNT_CARD",
                id,
                preset: this.currentPreset
            };
        }

        if (plan.combines) {
            const wantedCombines = new Set(plan.combines.ids);

            for (const id of this.activeCombines) {
                if (!wantedCombines.has(id)) return {
                    request: "C_DEACTIVATE_CARD_COMBINE_LIST",
                    reply: "S_DEACTIVATE_CARD_COMBINE_LIST",
                    id
                };
            }

            for (const id of wantedCombines) {
                if (!this.activeCombines.has(id)) return {
                    request: "C_ACTIVATE_CARD_COMBINE_LIST",
                    reply: "S_ACTIVATE_CARD_COMBINE_LIST",
                    id
                };
            }
        }

        return null;
    }

    schedule(delay = this.mod.settings.operationDelay) {
        if (this.destroyed || !this.selectionPending || this.timer || this.pending) return;

        this.timer = this.mod.setTimeout(() => {
            this.timer = null;

            try {
                this.reconcile();
            } catch (error) {
                this.blocked = true;

                this.message(this.t("selectionStopped", {
                    error: error.message
                }));
            }
        }, delay);
    }

    reconcile() {
        if (!this.selectionPending || !this.mod.settings.enabled || this.pending || this.blocked || this.loading || !this.me.alive) return;

        const plan = this.selectionPlan || this.plan();

        if (!plan) return;

        if (this.me.status !== 1) {
            this.selectionPlan = plan;
        }

        const operation = this.nextOperation(plan);
        const notice = `${this.target.gameId}:${plan.metrics}:${plan.collectionMetrics}:${plan.deck.ids.slice()
            .sort()}:${plan.combines?.ids.slice()
            .sort()}`;

        if (notice !== this.lastNotice) {
            this.lastNotice = notice;

            if (this.mod.settings.notifications) {
                this.message(
                    `${this.mod.settings.dryRun ? this.t("previewPrefix") : ""}${this.describePlan(plan)}${operation && this.me.status === 1 ? this.t("afterCombat") : ""}`
                );
            }
        }

        if (!operation || this.mod.settings.dryRun) {
            this.selectionPending = false;
            this.selectionPlan = null;

            return;
        }

        if (this.me.status === 1) return;

        const payload = {
            id: operation.id
        };

        if (operation.preset !== undefined) {
            payload.preset = operation.preset;
        }

        if (operation.request === "C_MOUNT_CARD") {
            payload.gameId = this.me.gameId;
        }

        operation.timer = this.mod.setTimeout(() => {
            if (this.pending !== operation) return;

            this.pending = null;
            this.blocked = true;

            this.message(this.t("noAcknowledgement", {
                request: operation.request,
                id: operation.id
            }));

            this.requestSnapshots();
        }, this.mod.settings.acknowledgementTimeout);

        this.pending = operation;
        this.debug(`${operation.request}: ${JSON.stringify(payload, (_, value) => (typeof value === "bigint" ? String(value) : value))}`);

        try {
            if (this.mod.send(operation.request, 1, payload) === false) throw new Error(this.t("sendFailed"));
        } catch (error) {
            this.mod.clearTimeout(operation.timer);
            this.pending = null;
            this.blocked = true;

            this.message(this.t("changesStopped", {
                error: error.message
            }));
        }
    }

    acknowledge(name, event) {
        const pending = this.pending;

        if (!pending || pending.reply !== name || pending.id !== event.id || pending.preset !== undefined && pending.preset !== event.preset) return;

        this.mod.clearTimeout(pending.timer);
        this.pending = null;
    }

    confirmFromSnapshot() {
        const pending = this.pending;

        if (!pending) return;

        let confirmed = false;

        if (pending.preset !== undefined) {
            const equipped = this.presets.get(pending.preset);

            if (equipped) {
                confirmed = equipped.has(pending.id) === (pending.request === "C_MOUNT_CARD");
            }
        } else if (this.combinesReady) {
            confirmed = this.activeCombines.has(pending.id) === (pending.request === "C_ACTIVATE_CARD_COMBINE_LIST");
        }

        if (confirmed) {
            this.mod.clearTimeout(pending.timer);
            this.pending = null;
        }
    }

    describePlan(plan) {
        const species = this.target.npc.species;
        const speciesName = this.catalog.speciesNames.get(species) || `speciesId=${species}`;
        const metric = statName(this.language, plan.metrics[0]);
        const format = number => Number(number.toFixed(4));
        let collectionText = this.t("unchanged");

        if (plan.combines) {
            const describe = statKey => {
                const permanent = `${statName(this.language, statKey)}: +${format(plan.combines.permanent[statKey] || 0)}`;
                const temporary = plan.combines.proc[statKey] || 0 ? `; ${this.t("combatProc")}: +${format(plan.combines.proc[statKey])}` : "";

                return `${permanent}${temporary}`;
            };

            collectionText = `${plan.combines.ids.join(", ") || "—"} (${describe(plan.collectionMetrics[0])}`;

            if (plan.collectionMetrics[1]) {
                collectionText += `; ${describe(plan.collectionMetrics[1])}`;
            }

            collectionText += `)${plan.damageMode ? ` ${this.t(plan.healerSupport ? "healerCollectionDamageComparison" : "damageComparison")}` : ""}`;
        }

        const report = this.t("plan", {
            zone: this.target.zone,
            template: this.target.template,
            species: speciesName,
            cards: plan.deck.ids.join(", ") || "—",
            stat: metric,
            value: format(plan.deck.primary),
            collections: collectionText
        });

        const overlap = plan.combines?.conflicts?.length || plan.deck.conflicts?.length;

        return report + (plan.healerSupport ? this.t("healerSupport") + (plan.powerMode ? this.t("healerDamage") : "") : "") + (plan.healerCrit ? this.t("healerCrit") : "") + (overlap ? this.t("replacementEstimate") : "") + (plan.powerMode ? this.t("deckPower", {
            power: format(plan.deck.power),
            gain: plan.deck.damageGain === null ? "—" : format(plan.deck.damageGain * 100)
        }) + this.t("deckPiercing", {
            stat: statName(this.language, `${plan.metrics[0].startsWith("physical") ? "physical" : "magical"}Piercing`),
            value: format(plan.deck.piercing)
        }) + (plan.deck.damageBonus ? this.t("deckDamageBonus", {
            value: format(plan.deck.damageBonus * 100)
        }) : "") + this.t("deckReference") : "");
    }

    preview() {
        const plan = this.plan();

        this.message(plan ? this.describePlan(plan) : this.status());
    }

    status() {
        const states = [this.t(this.mod.settings.enabled ? "statusEnabled" : "statusDisabled")];

        if (this.mod.settings.dryRun) {
            states.push(this.t("statusPreview"));
        }

        if (!this.catalog.loaded) {
            states.push(this.t("statusDataCenter"));
        }

        if (!this.cardsReady) {
            states.push(this.t("statusCards"));
        }

        if (this.mod.settings.manageCombines && !this.combinesReady) {
            states.push(this.t("statusCollections"));
        }

        if (this.loading) {
            states.push(this.t("statusLoading"));
        }

        if (this.me.status === 1) {
            states.push(this.t("statusCombat"));
        }

        if (this.blocked) {
            states.push(this.t("statusBlocked"));
        }

        if (this.pending) {
            states.push(this.t("statusPending", {
                reply: this.pending.reply
            }));
        }

        const metric = settings.priorities(this.mod.settings, this.me.job)[0];
        const offensive = /^(physical|magical)(CritPower|Attack|Piercing|DefenseReduction)$/.test(metric);
        const healer = [6, 7].includes(this.me.job);
        const needsPower = this.mod.settings.optimizePower && (offensive || healer && metric === "magicalDefense");
        const needsDamage = needsPower || !healer && offensive && this.mod.settings.manageCombines && this.mod.settings.collectionPriority === "cards";

        if (needsDamage && this.learnedSkillRanks === null) {
            states.push(this.t("statusSkills"));
        }

        if (this.selectionPending && this.target && !this.selectionPlan && needsDamage && (!this.playerStats || !this.damageSkills.length || needsPower && !damage.DAMAGE_STATS.every(key => Number.isFinite(this.playerStats[key])))) {
            states.push(this.t("statusDamageData"));
        }

        states.push(this.target ? this.t("statusTarget", {
            zone: this.target.zone,
            template: this.target.template,
            species: this.target.npc.species
        }) : this.t("statusNoTarget"));

        return states.join("; ");
    }

    updateSettings(value) {
        this.mod.settings = settings.normalize(value);
        this.mod.saveSettings();
        this.blocked = false;
        this.lastNotice = "";

        if (this.gui) {
            this.gui.settings = {
                ...this.mod.settings
            };
        }

        this.chooseTarget();
        this.requestSelection();
    }

    showGui() {
        this.language = toolboxLanguage();

        if (!global.TeraProxy?.GUIMode) {
            this.message(this.t("guiUnavailable"));

            return;
        }

        if (this.gui) {
            this.gui.destructor();
            this.gui = null;
        }

        if (!this.gui) {
            try {
                const SettingsUI = require("tera-mod-ui").Settings;

                const guiMod = {
                    ...this.mod,
                    info: {
                        ...this.mod.info,
                        options: {
                            ...this.mod.info.options,
                            guiName: NAME
                        }
                    }
                };

                this.gui = new SettingsUI(guiMod, settingsStructure(this.language), {
                    ...this.mod.settings
                }, {
                    width: 760,
                    height: 840,
                    resizable: true
                });

                this.gui.on("update", value => this.updateSettings(value));
            } catch (error) {
                this.message(this.t("guiError", {
                    error: error.message
                }));

                return;
            }
        }

        this.gui.show();
    }

    t(key, values) {
        return text(this.language, key, values);
    }

    message(messageText) {
        if (!this.destroyed) {
            this.mod.command.message(`[${NAME}] ${messageText}`);
        }
    }

    debug(messageText) {
        if (this.mod.settings.debug && !this.destroyed) {
            this.mod.log(messageText);
        }
    }

    clearSchedule() {
        if (this.timer) {
            this.mod.clearTimeout(this.timer);
        }

        this.timer = null;
    }

    cancelTimers() {
        this.clearSchedule();

        if (this.pending) {
            this.mod.clearTimeout(this.pending.timer);
        }

        this.pending = null;
    }

    saveState() {
        const state = {};

        for (const key of [
            "me",
            "loading",
            "lifeEpoch",
            "revivalPending",
            "registered",
            "presets",
            "currentPreset",
            "collectionLevel",
            "activeCombines",
            "cardsReady",
            "combinesReady",
            "mobs",
            "goneMobs",
            "target",
            "selectionPending",
            "playerStats",
            "statSources",
            "damageSkills",
            "learnedSkillRanks",
            "activeProcBuffs"
        ]) {
            state[key] = this[key];
        }

        state.blocked = Boolean(this.pending) || this.blocked;
        state.collectionEffectRevision = this.catalog.collectionEffectRevision;
        state.npcClassificationRevision = this.catalog.npcClassificationRevision;

        return state;
    }

    loadState(state) {
        if (!state) return;

        for (const key of [
            "me",
            "loading",
            "lifeEpoch",
            "revivalPending",
            "registered",
            "presets",
            "currentPreset",
            "collectionLevel",
            "activeCombines",
            "cardsReady",
            "combinesReady",
            "mobs",
            "goneMobs",
            "target",
            "blocked",
            "selectionPending",
            "playerStats",
            "statSources",
            "damageSkills",
            "learnedSkillRanks",
            "activeProcBuffs"
        ]) {
            if (state[key] !== undefined) {
                this[key] = state[key];
            }
        }

        if (this.playerStats && !this.statSources) {
            this.statSources = {
                procs: [...this.activeProcBuffs]
            };
        }

        this.captureStatLoadout();

        if (this.blocked) {
            this.requestSnapshots();
        }

        const catalogChanged = state.collectionEffectRevision !== this.catalog.collectionEffectRevision;

        if (catalogChanged) {
            this.damageSkills = [];
            this.loadDamageSkills();
        }

        if (catalogChanged || state.npcClassificationRevision !== this.catalog.npcClassificationRevision) {
            for (const mob of this.mobs.values()) {
                mob.npc = null;
            }
        } else if (this.target && !this.isEligible(this.target)) {
            this.chooseTarget();
        }

        this.schedule();
    }

    destructor() {
        this.destroyed = true;
        this.epoch++;
        this.cancelTimers();

        if (this.gui) {
            this.gui.destructor();
        }

        for (const hook of this.hooks) {
            this.mod.unhook(hook);
        }

        this.mod.command.remove(COMMANDS);
    }
}

module.exports = {
    ClientMod,
    NetworkMod
};
