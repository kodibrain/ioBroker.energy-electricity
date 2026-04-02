'use strict';
/**
 * Pads a value with a leading zero to 2 characters.
 *
 * @param {*} v Value to pad.
 * @returns {string} Padded string.
 */
function pad2(v) {
    return String(v).padStart(2, '0');
}
/**
 * Parses a value to a number and falls back to a default value.
 *
 * @param {*} val Value to parse.
 * @param {number} [def] Default value if parsing fails.
 * @returns {number} Parsed number or default value.
 */
function parseNum(val, def = 0) {
    if (val === null || val === undefined || val === '') {
        return def;
    }
    const normalized = String(val).replace(',', '.');
    const num = Number(normalized);
    return isFinite(num) ? num : def;
}
/**
 * Rounds a value to the specified number of decimal places.
 *
 * @param {*} v Value to round.
 * @param {number} [digits] Number of decimal places.
 * @returns {number} Rounded number.
 */
function round(v, digits = 3) {
    const p = Math.pow(10, digits);
    return Math.round((parseNum(v, 0) + Number.EPSILON) * p) / p;
}
/**
 * Creates a copy of a date object.
 *
 * @param {Date} d Source date.
 * @returns {Date} Cloned date.
 */
function cloneDate(d) {
    return new Date(d.getTime());
}
/**
 * Returns the start of the given day.
 *
 * @param {Date} d Source date.
 * @returns {Date} Date at 00:00:00.000.
 */
function startOfDay(d) {
    const x = cloneDate(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
/**
 * Adds a number of days to a date.
 *
 * @param {Date} d Source date.
 * @param {number} days Number of days to add.
 * @returns {Date} New date with added days.
 */
function addDays(d, days) {
    const x = cloneDate(d);
    x.setDate(x.getDate() + days);
    return x;
}
/**
 * Adds a number of years to a date.
 *
 * @param {Date} d Source date.
 * @param {number} years Number of years to add.
 * @returns {Date} New date with added years.
 */
function addYears(d, years) {
    const x = cloneDate(d);
    x.setFullYear(x.getFullYear() + years);
    return x;
}
/**
 * Returns the start of the month for the given date.
 *
 * @param {Date} d Source date.
 * @returns {Date} First day of month at 00:00:00.000.
 */
function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
/**
 * Returns the end of the month for the given date.
 *
 * @param {Date} d Source date.
 * @returns {Date} Last day of month at 23:59:59.999.
 */
function endOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
/**
 * Returns the number of days in the month of the given date.
 *
 * @param {Date} d Source date.
 * @returns {number} Number of days in month.
 */
function daysInMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
/**
 * Creates a YYYY-MM-DD key from a date.
 *
 * @param {Date} d Source date.
 * @returns {string} Date key in YYYY-MM-DD format.
 */
function dateKey(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/**
 * Formats a date as YYYY-MM-DD.
 *
 * @param {Date} d Source date.
 * @returns {string} Formatted date string.
 */
function fmtDate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/**
 * Parses a date string in YYYY-MM-DD format.
 *
 * @param {string} str Date string.
 * @returns {Date|null} Parsed date or null if invalid.
 */
function parseDateOnly(str) {
    if (!str || typeof str !== 'string') {
        return null;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str.trim());
    if (!m) {
        return null;
    }
    return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
}
/**
 * Normalizes a date input to YYYY-MM-DD format if possible.
 *
 * @param {*} input Input date string.
 * @returns {string} Normalized date string or original input as string.
 */
function normalizeDate(input) {
    if (!input) {
        return '';
    }
    input = String(input).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        return input;
    }
    let m = input.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) {
        const d = m[1].padStart(2, '0');
        const mo = m[2].padStart(2, '0');
        const y = m[3];
        return `${y}-${mo}-${d}`;
    }
    return input;
}
module.exports = {
    pad2,
    parseNum,
    round,
    cloneDate,
    startOfDay,
    addDays,
    addYears,
    startOfMonth,
    endOfMonth,
    daysInMonth,
    dateKey,
    fmtDate,
    parseDateOnly,
    normalizeDate,
};
