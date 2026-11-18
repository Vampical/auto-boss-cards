"use strict";
const NAME = "Auto Boss Cards";

const LOCALES = Object.freeze({
    en: require("./locales/en.json"),
    ru: require("./locales/ru.json")
});

const LANGUAGES = Object.freeze(Object.keys(LOCALES));

function language(value) {
    return LANGUAGES.includes(value) ? value : "en";
}

function toolboxLanguage(readConfig = () => require("../../../bin/config")
    .loadConfig(), readMuiLanguage = () => require("tera-toolbox-mui")
    .DefaultInstance.language) {
    try {
        const selected = readConfig()?.uilanguage;

        if (selected) return language(selected);
    } catch (_) {}

    try {
        return language(readMuiLanguage());
    } catch (_) {
        return "en";
    }
}

function text(locale, key, values = {}) {
    const template = LOCALES[language(locale)][key];

    if (typeof template !== "string") throw new Error(`Unknown translation key: ${key}`);

    return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}

function statName(locale, stat) {
    return text(locale, `stat_${stat}`);
}

function loadSettingsFile(modulePath) {
    const filename = require.resolve(modulePath);

    delete require.cache[filename];
    const structure = require(filename);

    if (!Array.isArray(structure)) throw new TypeError("The GUI settings file must export an array.");

    return structure;
}

function settingsStructure(locale = toolboxLanguage()) {
    const selected = language(locale);

    if (selected !== "en") {
        try {
            return loadSettingsFile(`./settings_${selected}`);
        } catch (_) {}
    }

    return loadSettingsFile("./settings");
}

module.exports = {
    NAME,
    LANGUAGES,
    language,
    toolboxLanguage,
    text,
    statName,
    settingsStructure
};
