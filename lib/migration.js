"use strict";

const { normalize } = require("./config");

module.exports = function migrateSettings(fromVersion, toVersion, settings) {
    return normalize(settings);
};
