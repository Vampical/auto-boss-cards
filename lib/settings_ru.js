"use strict";

function createStatOptions() {
    return [
        {
            key: "power",
            name: "Сила"
        },
        {
            key: "magicalDefense",
            name: "Магическая защита"
        },
        {
            key: "physicalCritPower",
            name: "Физический крит. павер"
        },
        {
            key: "magicalCritPower",
            name: "Магический крит. павер"
        },
        {
            key: "physicalAttack",
            name: "Физическая атака"
        },
        {
            key: "magicalAttack",
            name: "Магическая атака"
        },
        {
            key: "physicalPiercing",
            name: "Физическое пробивание"
        },
        {
            key: "magicalPiercing",
            name: "Магическое пробивание"
        },
        {
            key: "physicalDefenseReduction",
            name: "Фиксированное снижение физ. сопротивления"
        },
        {
            key: "magicalDefenseReduction",
            name: "Фиксированное снижение маг. сопротивления"
        },
        {
            key: "physicalDefense",
            name: "Физическая защита"
        },
        {
            key: "critFactor",
            name: "Крит. фактор"
        }
    ];
}

module.exports = [
    {
        key: "enabled",
        name: "<b>Автоматически менять карты</b>",
        type: "bool"
    },
    {
        key: "priority",
        name: "<b>Главный приоритет карт</b>",
        type: "select",
        options: [
            {
                key: "class",
                name: "По настройке класса ниже"
            },
            ...createStatOptions()
        ]
    },
    {
        key: "optimizePower",
        name: "Подбирать карты по урону с силой и пробиванием",
        type: "bool"
    },
    {
        key: "secondary",
        name: "Второй стат карт при равном главном",
        type: "select",
        options: [
            {
                key: "none",
                name: "Не учитывать"
            },
            ...createStatOptions()
        ]
    },
    {
        key: "collectionPriority",
        name: "Главный приоритет коллекций",
        type: "select",
        options: [
            {
                key: "cards",
                name: "Авто: прирост урона / стат карт для хилов"
            },
            ...createStatOptions()
        ]
    },
    {
        key: "collectionSecondary",
        name: "Второй стат коллекций при равном главном",
        type: "select",
        options: [
            {
                key: "auto",
                name: "Авто (для крит. павера — атака)"
            },
            {
                key: "none",
                name: "Не учитывать"
            },
            ...createStatOptions()
        ]
    },
    {
        key: "useSpecies",
        name: "Учитывать бонусы против speciesId цели",
        type: "bool"
    },
    {
        key: "detectOnSpawn",
        name: "Распознавать известных боссов при появлении",
        type: "bool"
    },
    {
        key: "includeBams",
        name: "Подбирать карты также для БАМов",
        type: "bool"
    },
    {
        key: "detectionRange",
        name: "Дальность выбора ближайшего босса / БАМа, м",
        type: "number",
        min: 10,
        max: 300,
        step: 10
    },
    {
        key: "manageCombines",
        name: "Подбирать также эффекты коллекций",
        type: "bool"
    },
    {
        key: "dryRun",
        name: "Только расчёт (не менять карты и коллекции)",
        type: "bool"
    },
    {
        key: "notifications",
        name: "Сообщать о выбранном наборе в чате",
        type: "bool"
    },
    {
        key: "job0",
        name: "Воин — приоритет",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job1",
        name: "Рыцарь — приоритет",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job2",
        name: "Убийца — приоритет",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job3",
        name: "Берсерк — приоритет",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job4",
        name: "Маг — приоритет",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job5",
        name: "Лучник — приоритет",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job6",
        name: "Жрец — приоритет",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job7",
        name: "Мистик — приоритет",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job8",
        name: "Жнец — приоритет",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job9",
        name: "Инженер — приоритет",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job10",
        name: "Крушитель — приоритет",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job11",
        name: "Шиноби — приоритет",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "job12",
        name: "Валькирия — приоритет",
        type: "select",
        options: createStatOptions()
    },
    {
        key: "operationDelay",
        name: "Пауза между подтверждёнными операциями, мс",
        type: "number",
        min: 50,
        max: 2000,
        step: 10
    },
    {
        key: "acknowledgementTimeout",
        name: "Ожидание ответа сервера, мс",
        type: "number",
        min: 1000,
        max: 30000,
        step: 500
    },
    {
        key: "debug",
        name: "Диагностика в консоли Toolbox",
        type: "bool"
    }
];
