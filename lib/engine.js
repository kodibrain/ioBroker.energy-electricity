'use strict';
const {
    getTariffForDate,
    getCurrentTariff,
    getPreviousTariff,
    getTariffs,
    getFeedInTariffForDate,
    getCurrentFeedInTariff,
    getPreviousFeedInTariff,
    getFeedInTariffs,
} = require('./tariffs');
const { parseNum, round, startOfDay, addDays, startOfMonth, endOfMonth } = require('./utils');

const EEG_RATE_PERIODS = [
    {
        start: '2024-08-01',
        end: '2025-01-31',
        building: {
            surplus: { tier1: 0.0803, tier2: 0.0695, tier3: 0.0568 },
            full: { tier1: 0.1295, tier2: 0.1090, tier3: 0.1090 },
        },
        other: {
            surplus: { tier1: 0.0658, tier2: 0.0658, tier3: 0.0658 },
            full: { tier1: 0.0658, tier2: 0.0658, tier3: 0.0658 },
        },
    },
    {
        start: '2025-02-01',
        end: '2025-07-31',
        building: {
            surplus: { tier1: 0.0794, tier2: 0.0688, tier3: 0.0562 },
            full: { tier1: 0.1282, tier2: 0.1079, tier3: 0.1079 },
        },
        other: {
            surplus: { tier1: 0.0652, tier2: 0.0652, tier3: 0.0652 },
            full: { tier1: 0.0652, tier2: 0.0652, tier3: 0.0652 },
        },
    },
    {
        start: '2025-08-01',
        end: '2026-01-31',
        building: {
            surplus: { tier1: 0.0786, tier2: 0.0680, tier3: 0.0556 },
            full: { tier1: 0.1270, tier2: 0.1068, tier3: 0.1068 },
        },
        other: {
            surplus: { tier1: 0.0645, tier2: 0.0645, tier3: 0.0645 },
            full: { tier1: 0.0645, tier2: 0.0645, tier3: 0.0645 },
        },
    },
    {
        start: '2026-02-01',
        end: '2026-07-31',
        building: {
            surplus: { tier1: 0.0778, tier2: 0.0673, tier3: 0.0550 },
            full: { tier1: 0.1234, tier2: 0.1035, tier3: 0.1035 },
        },
        other: {
            surplus: { tier1: 0.0626, tier2: 0.0626, tier3: 0.0626 },
            full: { tier1: 0.0626, tier2: 0.0626, tier3: 0.0626 },
        },
    },
];

function parseDateAtLocalMidnight(value) {
    if (!value) return null;
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function buildEegTiers(installedKw) {
    const kw = Math.max(0, parseNum(installedKw, 0));
    const tier1 = Math.max(0, Math.min(kw, 10));
    const tier2 = Math.max(0, Math.min(kw - 10, 30));
    const tier3 = Math.max(0, Math.min(kw - 40, 60));
    const tiers = [];
    if (tier1 > 0) tiers.push({ key: 'tier1', kwp: tier1 });
    if (tier2 > 0) tiers.push({ key: 'tier2', kwp: tier2 });
    if (tier3 > 0) tiers.push({ key: 'tier3', kwp: tier3 });
    return tiers;
}

function getEegRatePeriod(commissioningDate) {
    const date = parseDateAtLocalMidnight(commissioningDate);
    if (!date) return null;
    const ts = startOfDay(date).getTime();
    return EEG_RATE_PERIODS.find(period => {
        const startTs = startOfDay(parseDateAtLocalMidnight(period.start)).getTime();
        const endTs = startOfDay(parseDateAtLocalMidnight(period.end)).getTime();
        return ts >= startTs && ts <= endTs;
    }) || null;
}

function calcFeedInRevenue(feedInKwh, tariff) {
    const energy = Math.max(0, parseNum(feedInKwh, 0));
    if (!tariff || energy <= 0) {
        return { revenue: 0, averageRate: 0, auto: false };
    }

    if (!tariff.eegAutomatik) {
        const manualRate = parseNum(tariff.einspeiseverguetung, 0);
        return {
            revenue: energy * manualRate,
            averageRate: manualRate,
            auto: false,
        };
    }

    const installedPower = parseNum(tariff.eegAnlagenleistung, 0);
    const ratePeriod = getEegRatePeriod(tariff.eegInbetriebnahme);
    const tiers = buildEegTiers(installedPower);
    const category = tariff.eegAnlagenart === 'other' ? 'other' : 'building';
    const feedType = tariff.eegEinspeiseart === 'full' ? 'full' : 'surplus';

    if (!ratePeriod || !tiers.length || installedPower <= 0 || !ratePeriod[category] || !ratePeriod[category][feedType]) {
        const fallbackRate = parseNum(tariff.einspeiseverguetung, 0);
        return {
            revenue: energy * fallbackRate,
            averageRate: fallbackRate,
            auto: false,
        };
    }

    const rates = ratePeriod[category][feedType];
    let revenue = 0;
    for (const tier of tiers) {
        const share = tier.kwp / installedPower;
        const tierEnergy = energy * share;
        const rate = parseNum(rates[tier.key], 0);
        revenue += tierEnergy * rate;
    }

    return {
        revenue,
        averageRate: energy > 0 ? revenue / energy : 0,
        auto: true,
    };
}


function getDailyBasePrice(config, dateObj) {
    const tariff = getTariffForDate(config, dateObj);
    if (!tariff) return 0;
    const daysInMonth = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate();
    return tariff.grundgebuehr / daysInMonth;
}

function getConsumptionPaymentForDate(config, dateObj) {
    const tariff = getTariffForDate(config, dateObj);
    if (!tariff) return 0;
    const dim = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate();
    const payDay = Math.min(dim, tariff.abschlagTag);
    return dateObj.getDate() === payDay ? tariff.abschlag : 0;
}

function getFeedInPaymentForDate(config, dateObj) {
    const tariff = getFeedInTariffForDate(config, dateObj);
    if (!tariff) return 0;
    const dim = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate();
    const payDay = Math.min(dim, tariff.abschlagTag);
    return dateObj.getDate() === payDay ? tariff.abschlag : 0;
}

function calcDayFinance(config, consumption, feedIn, dateObj) {
    const consumptionTariff = getTariffForDate(config, dateObj);
    const feedInTariff = getFeedInTariffForDate(config, dateObj);
    const workPrice = consumptionTariff ? parseNum(consumptionTariff.arbeitspreis, 0) : 0;
    const feedInRevenue = calcFeedInRevenue(feedIn, feedInTariff);
    const costs = consumption * workPrice + getDailyBasePrice(config, dateObj);
    const revenue = feedInRevenue.revenue;
    const consumptionPayment = getConsumptionPaymentForDate(config, dateObj);
    const feedInPayment = getFeedInPaymentForDate(config, dateObj);
    return {
        kosten: round(costs, 2),
        erloes: round(revenue, 2),
        abschlaege: round(consumptionPayment + feedInPayment, 2),
        saldo: round(consumptionPayment + feedInPayment + revenue - costs, 2),
        bezug_abschlag: round(consumptionPayment, 2),
        einspeisung_abschlag: round(feedInPayment, 2),
        einspeisung_saldo: round(revenue - feedInPayment, 2),
    };
}

function countPaymentsBetween(config, startDate, endDate, type = 'consumption') {
    let sum = 0;
    let d = startOfDay(startDate);
    const end = startOfDay(endDate).getTime();
    while (d.getTime() <= end) {
        sum += type === 'feedin' ? getFeedInPaymentForDate(config, d) : getConsumptionPaymentForDate(config, d);
        d = addDays(d, 1);
    }
    return sum;
}

function calcBaseCostBetween(config, startDate, endDate) {
    let total = 0;
    let d = startOfDay(startDate);
    const end = startOfDay(endDate).getTime();
    while (d.getTime() <= end) {
        total += getDailyBasePrice(config, d);
        d = addDays(d, 1);
    }
    return total;
}

function getTariffChangePointsWithinPeriod(config, startDate, endDate) {
    const tariffs = getTariffs(config);
    const startTs = startOfDay(startDate).getTime();
    const endTs = startOfDay(endDate).getTime();
    return tariffs.filter(t => {
        const ts = startOfDay(t.start).getTime();
        return ts > startTs && ts <= endTs;
    });
}

function getFeedInTariffChangePointsWithinPeriod(config, startDate, endDate) {
    const tariffs = getFeedInTariffs(config);
    const startTs = startOfDay(startDate).getTime();
    const endTs = startOfDay(endDate).getTime();
    return tariffs.filter(t => {
        const ts = startOfDay(t.start).getTime();
        return ts > startTs && ts <= endTs;
    });
}

function calcLiveDay(config, meters, starts, refDate = new Date()) {
    const consumption = Math.max(0, parseNum(meters.consumption, 0) - parseNum(starts.consumption, parseNum(meters.consumption, 0)));
    const feedIn = Math.max(0, parseNum(meters.feedIn, 0) - parseNum(starts.feedIn, parseNum(meters.feedIn, 0)));
    return {
        verbrauch: round(consumption, 3),
        einspeisung: round(feedIn, 3),
        ...calcDayFinance(config, consumption, feedIn, refDate),
    };
}

function emptyTotals() {
    return {
        verbrauch: 0,
        einspeisung: 0,
        kosten: 0,
        erloes: 0,
        abschlaege: 0,
        saldo: 0,
        bezug_abschlaege: 0,
        einspeisung_abschlaege: 0,
        einspeisung_saldo: 0,
    };
}

function getOptionalNumber(value) {
    const parsed = parseNum(value, NaN);
    return Number.isFinite(parsed) ? parsed : null;
}

function buildSegmentPoints(config, startDate, startMeters, endDate, endMeters) {
    const points = [{
        date: startOfDay(startDate),
        consumption: parseNum(startMeters.consumption, 0),
        feedIn: parseNum(startMeters.feedIn, 0),
    }];

    for (const tariff of getTariffChangePointsWithinPeriod(config, startDate, endDate)) {
        points.push({
            date: startOfDay(tariff.start),
            consumption: getOptionalNumber(tariff.startzaehlerstand_bezug),
            feedIn: null,
            inferred: false,
        });
    }

    for (const tariff of getFeedInTariffChangePointsWithinPeriod(config, startDate, endDate)) {
        points.push({
            date: startOfDay(tariff.start),
            consumption: null,
            feedIn: getOptionalNumber(tariff.startzaehlerstand_einspeisung),
            inferred: false,
        });
    }

    points.push({
        date: startOfDay(endDate),
        consumption: parseNum(endMeters.consumption, 0),
        feedIn: parseNum(endMeters.feedIn, 0),
        isEnd: true,
    });

    points.sort((a, b) => a.date.getTime() - b.date.getTime());

    for (let i = 0; i < points.length; i++) {
        if (!Number.isFinite(points[i].consumption)) {
            const previous = i > 0 ? points[i - 1].consumption : null;
            points[i].consumption = Number.isFinite(previous) ? previous : 0;
            points[i].inferred = true;
        }
        if (!Number.isFinite(points[i].feedIn)) {
            const previous = i > 0 ? points[i - 1].feedIn : null;
            points[i].feedIn = Number.isFinite(previous) ? previous : 0;
            points[i].inferred = true;
        }
    }

    return points;
}

function calcPeriodSummaryByMeterBounds(config, startDate, startMeters, endDate, endMeters) {
    const startTs = startOfDay(startDate).getTime();
    const endTs = startOfDay(endDate).getTime();
    if (endTs < startTs) return emptyTotals();

    const points = buildSegmentPoints(config, startDate, startMeters, endDate, endMeters);

    let totalConsumption = 0;
    let totalFeedIn = 0;
    let totalCosts = 0;
    let totalRevenue = 0;

    for (let i = 0; i < points.length - 1; i++) {
        const current = points[i];
        const next = points[i + 1];
        const consumptionTariff = getTariffForDate(config, current.date);
        const feedInTariff = getFeedInTariffForDate(config, current.date);
        const workPrice = consumptionTariff ? parseNum(consumptionTariff.arbeitspreis, 0) : 0;
        const consumption = Math.max(0, parseNum(next.consumption, 0) - parseNum(current.consumption, 0));
        const feedIn = Math.max(0, parseNum(next.feedIn, 0) - parseNum(current.feedIn, 0));
        totalConsumption += consumption;
        totalFeedIn += feedIn;
        totalCosts += consumption * workPrice;
        totalRevenue += calcFeedInRevenue(feedIn, feedInTariff).revenue;
    }

    totalCosts += calcBaseCostBetween(config, startDate, endDate);
    const consumptionPayments = countPaymentsBetween(config, startDate, endDate, 'consumption');
    const feedInPayments = countPaymentsBetween(config, startDate, endDate, 'feedin');

    return {
        verbrauch: round(totalConsumption, 3),
        einspeisung: round(totalFeedIn, 3),
        kosten: round(totalCosts, 2),
        erloes: round(totalRevenue, 2),
        abschlaege: round(consumptionPayments + feedInPayments, 2),
        saldo: round(consumptionPayments + feedInPayments + totalRevenue - totalCosts, 2),
        bezug_abschlaege: round(consumptionPayments, 2),
        einspeisung_abschlaege: round(feedInPayments, 2),
        einspeisung_saldo: round(totalRevenue - feedInPayments, 2),
    };
}

function calcFeedInPeriodSummary(config, startDate, startFeedIn, endDate, endFeedIn) {
    const startTs = startOfDay(startDate).getTime();
    const endTs = startOfDay(endDate).getTime();
    if (endTs < startTs) return emptyTotals();

    const points = [{ date: startOfDay(startDate), feedIn: parseNum(startFeedIn, 0) }];
    for (const tariff of getFeedInTariffChangePointsWithinPeriod(config, startDate, endDate)) {
        points.push({ date: startOfDay(tariff.start), feedIn: getOptionalNumber(tariff.startzaehlerstand_einspeisung) });
    }
    points.push({ date: startOfDay(endDate), feedIn: parseNum(endFeedIn, 0), isEnd: true });
    points.sort((a, b) => a.date.getTime() - b.date.getTime());

    for (let i = 0; i < points.length; i++) {
        if (!Number.isFinite(points[i].feedIn)) {
            const previous = i > 0 ? points[i - 1].feedIn : null;
            points[i].feedIn = Number.isFinite(previous) ? previous : 0;
        }
    }

    let totalFeedIn = 0;
    let totalRevenue = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const current = points[i];
        const next = points[i + 1];
        const tariff = getFeedInTariffForDate(config, current.date);
        const feedIn = Math.max(0, parseNum(next.feedIn, 0) - parseNum(current.feedIn, 0));
        totalFeedIn += feedIn;
        totalRevenue += calcFeedInRevenue(feedIn, tariff).revenue;
    }

    const payments = countPaymentsBetween(config, startDate, endDate, 'feedin');
    return {
        verbrauch: 0,
        einspeisung: round(totalFeedIn, 3),
        kosten: 0,
        erloes: round(totalRevenue, 2),
        abschlaege: round(payments, 2),
        saldo: round(totalRevenue - payments, 2),
        bezug_abschlaege: 0,
        einspeisung_abschlaege: round(payments, 2),
        einspeisung_saldo: round(totalRevenue - payments, 2),
    };
}

function sumLedgerBetween(config, ledger, fromDate, toDate) {
    const sum = emptyTotals();
    const from = startOfDay(fromDate).getTime();
    const to = startOfDay(toDate).getTime();
    for (const key of Object.keys(ledger || {})) {
        const day = new Date(`${key}T00:00:00`);
        const ts = startOfDay(day).getTime();
        if (ts < from || ts > to) continue;
        const consumption = parseNum(ledger[key].verbrauch, 0);
        const feedIn = parseNum(ledger[key].einspeisung, 0);
        const finance = calcDayFinance(config, consumption, feedIn, day);
        sum.verbrauch += consumption;
        sum.einspeisung += feedIn;
        sum.kosten += finance.kosten;
        sum.erloes += finance.erloes;
        sum.abschlaege += finance.abschlaege;
        sum.saldo += finance.saldo;
        sum.bezug_abschlaege += finance.bezug_abschlag;
        sum.einspeisung_abschlaege += finance.einspeisung_abschlag;
        sum.einspeisung_saldo += finance.einspeisung_saldo;
    }
    sum.verbrauch = round(sum.verbrauch, 3);
    sum.einspeisung = round(sum.einspeisung, 3);
    sum.kosten = round(sum.kosten, 2);
    sum.erloes = round(sum.erloes, 2);
    sum.abschlaege = round(sum.abschlaege, 2);
    sum.saldo = round(sum.saldo, 2);
    sum.bezug_abschlaege = round(sum.bezug_abschlaege, 2);
    sum.einspeisung_abschlaege = round(sum.einspeisung_abschlaege, 2);
    sum.einspeisung_saldo = round(sum.einspeisung_saldo, 2);
    return sum;
}

function buildOutputValues(config, meters, dayStarts, ledger, monthStarts) {
    const now = new Date();
    const today = startOfDay(now);
    const yesterday = addDays(today, -1);
    const meterConsumption = parseNum(meters.consumption, 0);
    const meterFeedIn = parseNum(meters.feedIn, 0);
    const heute = calcLiveDay(config, { consumption: meterConsumption, feedIn: meterFeedIn }, dayStarts, now);
    const gestern = sumLedgerBetween(config, ledger, yesterday, yesterday);
    const monat = calcPeriodSummaryByMeterBounds(config, startOfMonth(now), monthStarts, now, { consumption: meterConsumption, feedIn: meterFeedIn });
    const prevMonthRef = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const letzterMonat = sumLedgerBetween(config, ledger, startOfMonth(prevMonthRef), endOfMonth(prevMonthRef));

    const currentTariff = getCurrentTariff(config, now);
    const abrechnungsjahr = currentTariff
        ? calcPeriodSummaryByMeterBounds(config, currentTariff.start, {
            consumption: currentTariff.startzaehlerstand_bezug,
            feedIn: meterFeedIn,
        }, now, { consumption: meterConsumption, feedIn: meterFeedIn })
        : emptyTotals();
    const previousTariff = getPreviousTariff(config, now);
    const letztesAbrechnungsjahr = previousTariff && currentTariff
        ? calcPeriodSummaryByMeterBounds(config, previousTariff.start, {
            consumption: previousTariff.startzaehlerstand_bezug,
            feedIn: meterFeedIn,
        }, addDays(currentTariff.start, -1), {
            consumption: currentTariff.startzaehlerstand_bezug,
            feedIn: meterFeedIn,
        })
        : emptyTotals();

    const currentFeedInTariff = getCurrentFeedInTariff(config, now);
    const eegAutoActive = isEegAutoActive(Math.max(meterFeedIn, 1), currentFeedInTariff);
    const einspeisungAbrechnungsjahr = currentFeedInTariff
        ? calcFeedInPeriodSummary(config, currentFeedInTariff.start, currentFeedInTariff.startzaehlerstand_einspeisung, now, meterFeedIn)
        : emptyTotals();
    const previousFeedInTariff = getPreviousFeedInTariff(config, now);
    const letztesEinspeisungAbrechnungsjahr = previousFeedInTariff && currentFeedInTariff
        ? calcFeedInPeriodSummary(
            config,
            previousFeedInTariff.start,
            previousFeedInTariff.startzaehlerstand_einspeisung,
            addDays(currentFeedInTariff.start, -1),
            currentFeedInTariff.startzaehlerstand_einspeisung,
        )
        : emptyTotals();

    return {
        'consumption.meter_reading': round(meterConsumption, 3),
        'feedin.meter_reading': round(meterFeedIn, 3),
        'feedin.eeg_auto_active': eegAutoActive,
        'today.consumption': heute.verbrauch,
        'today.feedin': heute.einspeisung,
        'today.costs': heute.kosten,
        'today.revenue': heute.erloes,
        'today.payments': heute.abschlaege,
        'today.balance': heute.saldo,
        'yesterday.consumption': gestern.verbrauch,
        'yesterday.feedin': gestern.einspeisung,
        'yesterday.costs': gestern.kosten,
        'yesterday.revenue': gestern.erloes,
        'yesterday.payments': gestern.abschlaege,
        'yesterday.balance': gestern.saldo,
        'month.consumption': monat.verbrauch,
        'month.feedin': monat.einspeisung,
        'month.costs': monat.kosten,
        'month.revenue': monat.erloes,
        'month.payments': monat.abschlaege,
        'month.balance': monat.saldo,
        'last_month.consumption': letzterMonat.verbrauch,
        'last_month.feedin': letzterMonat.einspeisung,
        'last_month.costs': letzterMonat.kosten,
        'last_month.revenue': letzterMonat.erloes,
        'last_month.payments': letzterMonat.abschlaege,
        'last_month.balance': letzterMonat.saldo,
        'billing_year.consumption': abrechnungsjahr.verbrauch,
        'billing_year.feedin': abrechnungsjahr.einspeisung,
        'billing_year.costs': abrechnungsjahr.kosten,
        'billing_year.revenue': abrechnungsjahr.erloes,
        'billing_year.payments': abrechnungsjahr.abschlaege,
        'billing_year.balance': abrechnungsjahr.saldo,
        'last_billing_year.consumption': letztesAbrechnungsjahr.verbrauch,
        'last_billing_year.feedin': letztesAbrechnungsjahr.einspeisung,
        'last_billing_year.costs': letztesAbrechnungsjahr.kosten,
        'last_billing_year.revenue': letztesAbrechnungsjahr.erloes,
        'last_billing_year.payments': letztesAbrechnungsjahr.abschlaege,
        'last_billing_year.balance': letztesAbrechnungsjahr.saldo,
        'feedin_billing_year.feedin': einspeisungAbrechnungsjahr.einspeisung,
        'feedin_billing_year.revenue': einspeisungAbrechnungsjahr.erloes,
        'feedin_billing_year.payments': einspeisungAbrechnungsjahr.einspeisung_abschlaege,
        'feedin_billing_year.balance': einspeisungAbrechnungsjahr.einspeisung_saldo,
        'last_feedin_billing_year.feedin': letztesEinspeisungAbrechnungsjahr.einspeisung,
        'last_feedin_billing_year.revenue': letztesEinspeisungAbrechnungsjahr.erloes,
        'last_feedin_billing_year.payments': letztesEinspeisungAbrechnungsjahr.einspeisung_abschlaege,
        'last_feedin_billing_year.balance': letztesEinspeisungAbrechnungsjahr.einspeisung_saldo,
    };
}

function closePreviousDay(startValues, endValues, previousDayKey, ledger) {
    const consumption = Math.max(0, parseNum(endValues.consumption, 0) - parseNum(startValues.consumption, 0));
    const feedIn = Math.max(0, parseNum(endValues.feedIn, 0) - parseNum(startValues.feedIn, 0));
    const next = { ...(ledger || {}) };
    next[previousDayKey] = {
        verbrauch: round(consumption, 3),
        einspeisung: round(feedIn, 3),
    };
    return next;
}

function isEegAutoActive(feedInKwh, tariff) {
    return !!calcFeedInRevenue(feedInKwh, tariff).auto;
}


module.exports = {
    calcDayFinance,
    calcLiveDay,
    calcPeriodSummaryByMeterBounds,
    sumLedgerBetween,
    buildOutputValues,
    closePreviousDay,
    calcFeedInRevenue,
    isEegAutoActive,
};
