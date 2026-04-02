'use strict';
const { parseDateOnly, startOfDay, parseNum, fmtDate, normalizeDate } = require('./utils');

function getTariffConfigByType(config, type = 'consumption') {
    if (type === 'feedin') {
        return {
            list: Array.isArray(config.feedInTariffs) ? config.feedInTariffs : [],
            startField: 'startzaehlerstand_einspeisung',
        };
    }

    return {
        list: Array.isArray(config.tariffs) ? config.tariffs : [],
        startField: 'startzaehlerstand_bezug',
    };
}

function normalizeTariffRow(row, type = 'consumption') {
    const normalizedStart = normalizeDate(row.startdatum);
    const base = {
        aktiv: !!row.aktiv,
        name: row.name || '',
        startdatum: normalizedStart,
        start: parseDateOnly(normalizedStart),
    };

    if (type === 'feedin') {
        return {
            ...base,
            startzaehlerstand_einspeisung: parseNum(row.startzaehlerstand_einspeisung, 0),
            einspeiseverguetung: parseNum(row.einspeiseverguetung, 0),
            abschlag: parseNum(row.abschlag, 0),
            abschlagTag: Math.max(1, Math.min(31, parseNum(row.abschlagTag, 1))),
            eegAutomatik: !!row.eegAutomatik,
            eegInbetriebnahme: normalizeDate(row.eegInbetriebnahme),
            eegEinspeiseart: row.eegEinspeiseart === 'full' ? 'full' : 'surplus',
            eegAnlagenart: row.eegAnlagenart === 'other' ? 'other' : 'building',
            eegAnlagenleistung: parseNum(row.eegAnlagenleistung, 0),
        };
    }

    return {
        ...base,
        startzaehlerstand_bezug: parseNum(row.startzaehlerstand_bezug, 0),
        grundgebuehr: parseNum(row.grundgebuehr, 0),
        arbeitspreis: parseNum(row.arbeitspreis, 0),
        abschlag: parseNum(row.abschlag, 0),
        abschlagTag: Math.max(1, Math.min(31, parseNum(row.abschlagTag, 1))),
    };
}

function getTariffsByType(config, type = 'consumption') {
    const { list } = getTariffConfigByType(config, type);
    return list
        .filter(t => t && t.aktiv && t.startdatum)
        .map(t => normalizeTariffRow(t, type))
        .filter(t => t.start instanceof Date && !isNaN(t.start.getTime()))
        .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function getTariffForDateByType(config, dateObj, type = 'consumption') {
    const tariffs = getTariffsByType(config, type);
    if (!tariffs.length) {
        return null;
    }
    const ts = startOfDay(dateObj).getTime();
    let current = null;

    for (const tariff of tariffs) {
        if (ts >= startOfDay(tariff.start).getTime()) {
            current = tariff;
        } else {
            break;
        }
    }
    return current;
}

function getCurrentTariffByType(config, dateObj = new Date(), type = 'consumption') {
    return getTariffForDateByType(config, dateObj, type);
}

function getPreviousTariffByType(config, dateObj = new Date(), type = 'consumption') {
    const tariffs = getTariffsByType(config, type);
    const current = getCurrentTariffByType(config, dateObj, type);
    if (!current) {
        return null;
    }
    const idx = tariffs.findIndex(t => t.start.getTime() === current.start.getTime());
    if (idx <= 0) {
        return null;
    }
    return tariffs[idx - 1];
}

function getNextTariffByType(config, dateObj = new Date(), type = 'consumption') {
    const tariffs = getTariffsByType(config, type);
    const current = getCurrentTariffByType(config, dateObj, type);
    if (!current) {
        return null;
    }
    const idx = tariffs.findIndex(t => t.start.getTime() === current.start.getTime());
    if (idx < 0 || idx >= tariffs.length - 1) {
        return null;
    }
    return tariffs[idx + 1];
}

function hasTariffWithStartDateByType(config, dateObj, type = 'consumption') {
    const target = fmtDate(dateObj);
    return getTariffsByType(config, type).some(t => t.startdatum === target);
}

function findTariffIndexByStartDateByType(config, dateObj, type = 'consumption') {
    const target = fmtDate(dateObj);
    const { list } = getTariffConfigByType(config, type);

    return list.findIndex(t => t && String(t.startdatum || '').trim() === target);
}

function getTariffs(config) {
    return getTariffsByType(config, 'consumption');
}
function getTariffForDate(config, dateObj) {
    return getTariffForDateByType(config, dateObj, 'consumption');
}
function getCurrentTariff(config, dateObj = new Date()) {
    return getCurrentTariffByType(config, dateObj, 'consumption');
}
function getPreviousTariff(config, dateObj = new Date()) {
    return getPreviousTariffByType(config, dateObj, 'consumption');
}
function getNextTariff(config, dateObj = new Date()) {
    return getNextTariffByType(config, dateObj, 'consumption');
}
function hasTariffWithStartDate(config, dateObj) {
    return hasTariffWithStartDateByType(config, dateObj, 'consumption');
}
function findTariffIndexByStartDate(config, dateObj) {
    return findTariffIndexByStartDateByType(config, dateObj, 'consumption');
}

function getFeedInTariffs(config) {
    return getTariffsByType(config, 'feedin');
}
function getFeedInTariffForDate(config, dateObj) {
    return getTariffForDateByType(config, dateObj, 'feedin');
}
function getCurrentFeedInTariff(config, dateObj = new Date()) {
    return getCurrentTariffByType(config, dateObj, 'feedin');
}
function getPreviousFeedInTariff(config, dateObj = new Date()) {
    return getPreviousTariffByType(config, dateObj, 'feedin');
}
function getNextFeedInTariff(config, dateObj = new Date()) {
    return getNextTariffByType(config, dateObj, 'feedin');
}
function findFeedInTariffIndexByStartDate(config, dateObj) {
    return findTariffIndexByStartDateByType(config, dateObj, 'feedin');
}

module.exports = {
    getTariffs,
    getTariffForDate,
    getCurrentTariff,
    getPreviousTariff,
    getNextTariff,
    hasTariffWithStartDate,
    findTariffIndexByStartDate,
    getTariffsByType,
    getTariffForDateByType,
    getCurrentTariffByType,
    getPreviousTariffByType,
    getNextTariffByType,
    hasTariffWithStartDateByType,
    findTariffIndexByStartDateByType,
    getFeedInTariffs,
    getFeedInTariffForDate,
    getCurrentFeedInTariff,
    getPreviousFeedInTariff,
    getNextFeedInTariff,
    findFeedInTariffIndexByStartDate,
};
