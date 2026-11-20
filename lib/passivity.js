"use strict";

module.exports.METHOD = Object.freeze({
    ADD_ABSOLUTE: 2,
    ADD_PERCENT: 3,
    SET_PERCENT: 4
});

module.exports.TYPES = Object.freeze({
    DAMAGE: 152,
    AFTER_DEFEATING_AN_ENEMY: 189,
    AFTER_A_RESURRECTION: 206,
    CRITICAL_HIT: 224,

    // Alternate collection trigger recorded in client metadata.
    CLIENT_COLLECTION_TRIGGER: 262
});
