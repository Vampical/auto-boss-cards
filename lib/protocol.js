"use strict";

// Card packet layouts; C_MOUNT_CARD includes a uint64 before preset/id.
const DEFINITIONS = {
    C_MOUNT_CARD: [
        ["gameId", "uint64"],
        ["preset", "uint32"],
        ["id", "uint32"]
    ],
    C_UNMOUNT_CARD: [
        ["preset", "uint32"],
        ["id", "uint32"]
    ],
    C_ACTIVATE_CARD_COMBINE_LIST: [
        ["id", "uint32"]
    ],
    C_DEACTIVATE_CARD_COMBINE_LIST: [
        ["id", "uint32"]
    ],
    C_REQUEST_OTHERS_CARD_DATA_WITH_GAMEID: [
        ["gameId", "uint64"]
    ],
    C_REQUEST_MY_ACTIVATE_CARD_COMBINE_LIST_DATA: [],
    S_MOUNT_CARD: [
        ["preset", "uint32"],
        ["id", "uint32"]
    ],
    S_UNMOUNT_CARD: [
        ["preset", "uint32"],
        ["id", "uint32"]
    ],
    S_REGISTER_CARD: [
        ["id", "uint32"],
        ["num", "uint32"],
        ["collectionScore", "uint32"]
    ],
    S_CARD_COLLECTION_BOOK_LEVEL_UP: [
        ["collectionLevel", "uint32"]
    ],
    S_CHANGE_CARD_PRESET: [
        ["preset", "uint32"]
    ],
    S_CARD_DATA_RESET: [],
    S_CARD_DATA: [
        ["cards", "refArray"],
        ["presets", "refArray"],
        ["unk", "uint32"],
        ["name", "refString"],
        ["gameId", "uint64"],
        ["numPresets", "uint32"],
        ["currentPreset", "uint32"],
        ["collectionLevel", "uint32"],
        ["collectionScore", "uint32"],
        ["name", "string"],
        [
            "cards",
            [
                ["id", "uint32"],
                ["num", "uint32"]
            ]
        ],
        [
            "presets",
            [
                ["equippedCards", "refArray"],
                ["preset", "uint32"],
                [
                    "equippedCards",
                    [
                        ["id", "uint32"]
                    ]
                ]
            ]
        ]
    ],
    S_ACTIVATE_CARD_COMBINE_LIST: [
        ["id", "uint32"]
    ],
    S_DEACTIVATE_CARD_COMBINE_LIST: [
        ["id", "uint32"]
    ],
    S_ACTIVATE_CARD_COMBINE_LIST_DATA: [
        ["combineList", "refArray"],
        ["name", "refString"],
        ["gameId", "uint64"],
        ["name", "string"],
        [
            "combineList",
            [
                ["id", "uint32"],
                ["level", "uint32"]
            ]
        ]
    ],
    S_BOSS_GAGE_STACK_INFO: [
        ["gameId", "uint64"],
        ["huntingZoneId", "uint32"],
        ["templateId", "uint32"],
        ["unk1", "byte"],
        ["stacks", "uint32"],
        ["stacksMax", "uint32"],
        ["unk2", "uint32"],
        ["unk3", "uint32"]
    ]
};

function prepare(fields, type = "root") {
    const result = fields.map(([name, field]) => [name, Array.isArray(field) ? prepare(field, "array") : field]);

    result.type = type;

    if (type === "array") {
        result.flags = [];
    }

    return result;
}

function install(mod) {
    for (const [name, definition] of Object.entries(DEFINITIONS)) {
        mod.dispatch.addDefinition(name, 1, prepare(definition), false);
    }
}

module.exports = {
    DEFINITIONS,
    prepare,
    install
};
