'use strict';

const utils = require('@iobroker/adapter-core');
const { ensureStates } = require('./lib/states');
const { buildOutputValues, closePreviousDay } = require('./lib/engine');
const {
    getTariffs,
    getFeedInTariffs,
    getCurrentTariff,
    getCurrentFeedInTariff,
    findTariffIndexByStartDate,
    findFeedInTariffIndexByStartDate,
} = require('./lib/tariffs');

const { dateKey, addYears, fmtDate, parseNum } = require('./lib/utils');

class EnergyElectricity extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: 'energy-electricity',
        });

        this.refreshTimer = null;
        this.ownStateIds = new Set(['consumption.meter_reading', 'feedin.meter_reading']);
        this.lastPulseTs = 0;

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async updateConnection(isConnected) {
        await this.setStateAsync('info.connection', { val: !!isConnected, ack: true }).catch(() => {});
    }

    async onReady() {
        await ensureStates(this);
        await this.updateConnection(false);

        const inputStateId = this.getConfiguredInputStateId();
        if (!inputStateId) {
            this.log.warn(`Adapter not active yet: ${this.getMissingInputMessage()}`);
            return;
        }

        const tariffs = getTariffs(this.config);
        if (!tariffs.length) {
            this.log.warn('Adapter not active yet: No active consumption tariff available');
            return;
        }

        if (this.getSourceType() === 'dual_meter') {
            const feedInTariffs = getFeedInTariffs(this.config);
            if (!feedInTariffs.length) {
                this.log.warn('Adapter not active yet: No active feed-in tariff available');
                return;
            }
        }

        const meterValues = await this.readCurrentMeterValues();
        if (meterValues === null) {
            this.log.warn(`Adapter not active yet: ${this.getInvalidInputMessage()}`);
            return;
        }

        await this.initCounterBaselineIfNeeded();
        await this.initDayStartIfNeeded(meterValues);
        await this.initMonthStartIfNeeded(meterValues);

        const updateMode = this.config.updateMode || 'both';
        const updateIntervalSeconds = Number(this.config.updateIntervalSeconds || 5);

        if (updateMode === 'change' || updateMode === 'both') {
            await this.subscribeConfiguredInputState();
        }

        if (this.getSourceType() === 'counter') {
            await this.subscribeStatesAsync('consumption.meter_reading');
        }

        if (updateMode === 'interval' || updateMode === 'both') {
            this.refreshTimer = this.setInterval(async () => {
                try {
                    await this.handlePeriodicUpdate();
                } catch (e) {
                    this.log.warn(`Interval update skipped: ${e.message}`);
                }
            }, updateIntervalSeconds * 1000);
        }

        await this.updateConnection(true);
        await this.handlePeriodicUpdate();
    }

    async onStateChange(id, state) {
        if (!state) {
            return;
        }

        if ((id === `${this.namespace}.consumption.meter_reading` || id === `${this.namespace}.feedin.meter_reading`) && state.ack !== true) {
            try {
                await this.handleManualMeterCorrection(state.val);
                await this.updateConnection(true);
            } catch (e) {
                await this.updateConnection(false);
                this.log.warn(`Manual meter correction failed: ${e.message}`);
            }
            return;
        }

        if (id !== this.getConfiguredInputStateId() && id !== this.getConfiguredFeedInStateId()) {
            return;
        }

        this.log.debug(`Meter reading change detected: ${id} = ${state.val}`);

        try {
            if (this.getSourceType() === 'counter') {
                await this.processCounterInputChange(state.val);
            }

            const meterValues = await this.readCurrentMeterValues();
            if (meterValues === null) {
                throw new Error(this.getInvalidInputMessage());
            }

            await this.handleValueUpdate(meterValues);
            await this.updateConnection(true);
        } catch (e) {
            await this.updateConnection(false);
            this.log.warn(`Processing after meter reading change failed: ${e.message}`);
        }
    }

    
    getSourceType() {
        return ['counter', 'meter', 'dual_meter'].includes(this.config.sourceType) ? this.config.sourceType : 'dual_meter';
    }

    getConfiguredInputStateId() {
        const sourceType = this.getSourceType();
        if (sourceType === 'counter') {
            return this.config.counterState && String(this.config.counterState).trim()
                ? String(this.config.counterState).trim()
                : '';
        }
        return this.config.consumptionState && String(this.config.consumptionState).trim()
            ? String(this.config.consumptionState).trim()
            : '';
    }

    getConfiguredFeedInStateId() {
        if (this.getSourceType() !== 'dual_meter') {
            return '';
        }
        return this.config.feedInState && String(this.config.feedInState).trim()
            ? String(this.config.feedInState).trim()
            : '';
    }

    getMissingInputMessage() {
        const sourceType = this.getSourceType();
        if (sourceType === 'counter') {
            return 'No counter data point configured';
        }
        if (sourceType === 'meter') {
            return 'No consumption meter data point configured';
        }
        return 'No consumption or feed-in meter data point configured';
    }

    getInvalidInputMessage() {
        const sourceType = this.getSourceType();
        const consumptionStateId = this.getConfiguredInputStateId();
        const feedInStateId = this.getConfiguredFeedInStateId();

        if (sourceType === 'counter') {
            return `Counter data point returned no valid value (${consumptionStateId})`;
        }
        if (sourceType === 'meter') {
            return `Consumption meter data point returned no valid value (${consumptionStateId})`;
        }
        return `Consumption or feed-in meter data point returned no valid value (${consumptionStateId}${feedInStateId ? ` / ${feedInStateId}` : ''})`;
    }

    async subscribeConfiguredInputState() {
        const consumptionStateId = this.getConfiguredInputStateId();
        if (consumptionStateId) {
            await this.subscribeForeignStatesAsync(consumptionStateId);
        }

        const feedInStateId = this.getConfiguredFeedInStateId();
        if (feedInStateId) {
            await this.subscribeForeignStatesAsync(feedInStateId);
        }
    }

    getCounterFactor() {
        return parseNum(this.config.counterFactor, NaN);
    }

    getCounterDebounceMs() {
        const value = Number(this.config.counterDebounceMs);
        return Number.isFinite(value) && value >= 0 ? value : 200;
    }

    getConfiguredCounterType() {
        const type = String(this.config.counterType || 'auto').trim();
        return ['auto', 'numeric', 'boolean'].includes(type) ? type : 'auto';
    }

    normalizeCounterRawValue(rawValue) {
        if (rawValue === null || rawValue === undefined || rawValue === '') {
            return null;
        }

        if (typeof rawValue === 'boolean' || typeof rawValue === 'number') {
            return rawValue;
        }

        const str = String(rawValue).trim();
        if (!str) {
            return null;
        }

        if (str.toLowerCase() === 'true') {
            return true;
        }
        if (str.toLowerCase() === 'false') {
            return false;
        }

        const num = parseNum(str, NaN);
        if (Number.isFinite(num)) {
            return num;
        }

        return str;
    }

    detectCounterType(rawValue) {
        if (typeof rawValue === 'boolean') {
            return 'boolean';
        }
        if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            return 'numeric';
        }
        return null;
    }

    async getDetectedCounterType(rawValue = undefined) {
        const configuredType = this.getConfiguredCounterType();
        if (configuredType !== 'auto') {
            return configuredType;
        }

        const existing = await this.getStateAsync('_intern.counter_detected_type');
        if (existing && existing.val) {
            const saved = String(existing.val);
            if (saved === 'numeric' || saved === 'boolean') {
                return saved;
            }
        }

        const normalized = rawValue === undefined ? undefined : this.normalizeCounterRawValue(rawValue);
        const detected = this.detectCounterType(normalized);

        if (detected) {
            await this.setStateAsync('_intern.counter_detected_type', { val: detected, ack: true });
            this.log.info(`Counter type detected automatically: ${detected}`);
        }

        return detected;
    }

    async getCounterOffset() {
        const state = await this.getStateAsync('_intern.counter_offset_consumption');
        return state ? parseNum(state.val, 0) : 0;
    }

    async setCounterOffset(value) {
        await this.setStateAsync('_intern.counter_offset_consumption', { val: value, ack: true });
    }

    async getPulseTotal() {
        const state = await this.getStateAsync('_intern.counter_pulse_total');
        return state ? parseNum(state.val, 0) : 0;
    }

    async setPulseTotal(value) {
        await this.setStateAsync('_intern.counter_pulse_total', { val: value, ack: true });
    }

    async readCurrentInputRawValue() {
        const inputStateId = this.getConfiguredInputStateId();
        if (!inputStateId) {
            return null;
        }

        const state = await this.getForeignStateAsync(inputStateId);
        if (!state || state.val === null || state.val === undefined || state.val === '') {
            return null;
        }

        return this.normalizeCounterRawValue(state.val);
    }

    async readCurrentFeedInRawValue() {
        const inputStateId = this.getConfiguredFeedInStateId();
        if (!inputStateId) {
            return 0;
        }

        const state = await this.getForeignStateAsync(inputStateId);
        if (!state || state.val === null || state.val === undefined || state.val === '') {
            return null;
        }

        return this.normalizeCounterRawValue(state.val);
    }

    async computeMeterValueFromInput(rawValue) {
        if (rawValue === null || rawValue === undefined || rawValue === '') {
            return null;
        }

        const sourceType = this.getSourceType();
        if (sourceType !== 'counter') {
            const meterValue = parseNum(rawValue, NaN);
            return Number.isFinite(meterValue) ? meterValue : null;
        }

        const counterFactor = this.getCounterFactor();
        if (!Number.isFinite(counterFactor)) {
            return null;
        }

        const detectedType = await this.getDetectedCounterType(rawValue);
        if (!detectedType) {
            return null;
        }

        const counterOffset = await this.getCounterOffset();

        if (detectedType === 'numeric') {
            const counterValue = parseNum(rawValue, NaN);
            if (!Number.isFinite(counterValue)) {
                return null;
            }
            return counterValue * counterFactor + counterOffset;
        }

        const pulseTotal = await this.getPulseTotal();
        return pulseTotal * counterFactor + counterOffset;
    }

    async readCurrentMeterValues() {
        const rawValue = await this.readCurrentInputRawValue();
        if (rawValue === null) {
            return null;
        }
        const consumption = await this.computeMeterValueFromInput(rawValue);
        if (consumption === null) {
            return null;
        }
        if (this.getSourceType() !== 'dual_meter') {
            return { consumption, feedIn: 0 };
        }
        const feedRaw = await this.readCurrentFeedInRawValue();
        if (feedRaw === null) {
            return null;
        }
        const feedIn = parseNum(feedRaw, NaN);
        if (!Number.isFinite(feedIn)) {
            return null;
        }
        return { consumption, feedIn };
    }

    async initCounterBaselineIfNeeded() {
        if (this.getSourceType() !== 'counter') {
            return;
        }

        const rawValue = await this.readCurrentInputRawValue();
        if (rawValue === null) {
            return;
        }

        const detectedType = await this.getDetectedCounterType(rawValue);
        if (!detectedType) {
            return;
        }

        if (detectedType === 'numeric') {
            const lastRawState = await this.getStateAsync('_intern.counter_last_raw');
            const hasLastRaw =
                lastRawState &&
                lastRawState.val !== null &&
                lastRawState.val !== undefined &&
                String(lastRawState.val) !== '';
            if (!hasLastRaw) {
                await this.setStateAsync('_intern.counter_last_raw', { val: String(parseNum(rawValue, 0)), ack: true });
            }
            return;
        }

        const lastRawState = await this.getStateAsync('_intern.counter_last_raw');
        const hasLastRaw =
            lastRawState &&
            lastRawState.val !== null &&
            lastRawState.val !== undefined &&
            String(lastRawState.val) !== '';
        if (!hasLastRaw) {
            await this.setStateAsync('_intern.counter_last_raw', { val: String(rawValue === true), ack: true });
        }
    }

    async processCounterInputChange(rawValue) {
        const normalized = this.normalizeCounterRawValue(rawValue);
        const detectedType = await this.getDetectedCounterType(normalized);
        const counterFactor = this.getCounterFactor();

        if (!detectedType || !Number.isFinite(counterFactor)) {
            throw new Error('Counter type or counter factor is invalid');
        }

        if (detectedType === 'numeric') {
            const currentRaw = parseNum(normalized, NaN);
            if (!Number.isFinite(currentRaw)) {
                throw new Error('Counter data point returned no numeric value');
            }

            const lastRawState = await this.getStateAsync('_intern.counter_last_raw');
            const lastRaw =
                lastRawState &&
                lastRawState.val !== null &&
                lastRawState.val !== undefined &&
                String(lastRawState.val) !== ''
                    ? parseNum(lastRawState.val, NaN)
                    : NaN;

            if (Number.isFinite(lastRaw) && currentRaw < lastRaw) {
                const currentMeterState = await this.getStateAsync('consumption.meter_reading');
                const currentMeter = currentMeterState ? parseNum(currentMeterState.val, 0) : 0;
                const newOffset = currentMeter - currentRaw * counterFactor;
                await this.setCounterOffset(newOffset);
                this.log.warn(
                    `Numeric counter decreased (${lastRaw} -> ${currentRaw}). Offset was adjusted automatically to ${newOffset} kWh to prevent the meter reading from decreasing.`,
                );
            }

            await this.setStateAsync('_intern.counter_last_raw', { val: String(currentRaw), ack: true });
            await this.setStateAsync('consumption.counter', { val: currentRaw, ack: true });
            return;
        }

        if (typeof normalized !== 'boolean') {
            throw new Error('Counter data point returned no boolean value');
        }

        const lastRawState = await this.getStateAsync('_intern.counter_last_raw');
        const lastBool = lastRawState ? String(lastRawState.val).trim().toLowerCase() === 'true' : false;
        const now = Date.now();
        const debounceMs = this.getCounterDebounceMs();

        if (!lastBool && normalized === true) {
            if (now - this.lastPulseTs >= debounceMs) {
                const pulses = (await this.getPulseTotal()) + 1;
                await this.setPulseTotal(pulses);
                await this.setStateAsync('consumption.counter', { val: pulses, ack: true });
                this.lastPulseTs = now;
            }
        } else {
            const pulses = await this.getPulseTotal();
            await this.setStateAsync('consumption.counter', { val: pulses, ack: true });
        }

        await this.setStateAsync('_intern.counter_last_raw', { val: String(normalized), ack: true });
    }

    async handlePeriodicUpdate() {
        const meterValues = await this.readCurrentMeterValues();
        if (meterValues === null) {
            await this.updateConnection(false);
            throw new Error(this.getInvalidInputMessage());
        }

        await this.handleValueUpdate(meterValues);
        await this.updateConnection(true);
    }

    async handleManualMeterCorrection(targetValue) {
        if (this.getSourceType() !== 'counter') {
            await this.handlePeriodicUpdate();
            return;
        }

        const desiredMeter = parseNum(targetValue, NaN);
        if (!Number.isFinite(desiredMeter)) {
            throw new Error('Manual meter reading is invalid');
        }

        const rawValue = await this.readCurrentInputRawValue();
        if (rawValue === null) {
            throw new Error(this.getInvalidInputMessage());
        }

        const counterFactor = this.getCounterFactor();
        if (!Number.isFinite(counterFactor)) {
            throw new Error('Counter factor is invalid');
        }

        const detectedType = await this.getDetectedCounterType(rawValue);
        if (!detectedType) {
            throw new Error('Counter-Typ konnte nicht erkannt werden');
        }

        let newOffset;
        if (detectedType === 'numeric') {
            const counterValue = parseNum(rawValue, NaN);
            if (!Number.isFinite(counterValue)) {
                throw new Error('Counter data point returned no numeric value');
            }
            newOffset = desiredMeter - counterValue * counterFactor;
        } else {
            const pulses = await this.getPulseTotal();
            newOffset = desiredMeter - pulses * counterFactor;
        }

        await this.setCounterOffset(newOffset);
        this.log.info(`Counter offset set to ${newOffset} kWh . New meter reading: ${desiredMeter} kWh`);
        await this.handleValueUpdate({ consumption: desiredMeter, feedIn: 0 });
    }

    
    async initDayStartIfNeeded(currentMeters) {
        const todayKey = dateKey(new Date());
        const dayStartDateState = await this.getStateAsync('_intern.day_start_date');
        const savedDate = dayStartDateState && dayStartDateState.val ? String(dayStartDateState.val) : '';
        if (!savedDate || savedDate !== todayKey) {
            await this.setStateAsync('_intern.day_start_consumption', { val: currentMeters.consumption, ack: true });
            await this.setStateAsync('_intern.day_start_feedin', { val: currentMeters.feedIn, ack: true });
            await this.setStateAsync('_intern.day_start_date', { val: todayKey, ack: true });
        }
    }

    
    async initMonthStartIfNeeded(currentMeters) {
        const now = new Date();
        const currentMonthMarker = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const monthMarkerState = await this.getStateAsync('_intern.month_marker');
        const marker = monthMarkerState?.val ? String(monthMarkerState.val) : '';
        if (!marker) {
            await this.setStateAsync('_intern.month_start_consumption', { val: currentMeters.consumption, ack: true });
            await this.setStateAsync('_intern.month_start_feedin', { val: currentMeters.feedIn, ack: true });
            await this.setStateAsync('_intern.month_marker', { val: currentMonthMarker, ack: true });
        }
    }

    
    async handleMonthRollover(currentMeters) {
        const now = new Date();
        const currentMonthMarker = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const monthMarkerState = await this.getStateAsync('_intern.month_marker');
        const marker = monthMarkerState && monthMarkerState.val ? String(monthMarkerState.val) : '';
        if (marker === currentMonthMarker) {
            return;
        }
        let newMonthStartConsumption = currentMeters.consumption;
        let newMonthStartFeedIn = currentMeters.feedIn;
        if (now.getDate() === 1) {
            const dayStartConsumptionState = await this.getStateAsync('_intern.day_start_consumption');
            const dayStartFeedInState = await this.getStateAsync('_intern.day_start_feedin');
            if (dayStartConsumptionState?.val !== null && dayStartConsumptionState?.val !== undefined) {
                newMonthStartConsumption = parseNum(dayStartConsumptionState.val, currentMeters.consumption);
            }
            if (dayStartFeedInState?.val !== null && dayStartFeedInState?.val !== undefined) {
                newMonthStartFeedIn = parseNum(dayStartFeedInState.val, currentMeters.feedIn);
            }
        }
        await this.setStateAsync('_intern.month_start_consumption', { val: newMonthStartConsumption, ack: true });
        await this.setStateAsync('_intern.month_start_feedin', { val: newMonthStartFeedIn, ack: true });
        await this.setStateAsync('_intern.month_marker', { val: currentMonthMarker, ack: true });
        this.log.debug(`Month rollover detected, new month start consumption: ${newMonthStartConsumption} kWh, new month start feed-in: ${newMonthStartFeedIn} kWh`);
    }

    async handleAutoCreateNextTariff(currentMeter) {
        if (!this.config.autoCreateNextTariffAfterOneYear) {
            return;
        }

        const now = new Date();
        const consumptionRows = Array.isArray(this.config.tariffs) ? [...this.config.tariffs] : [];
        const feedInRows = Array.isArray(this.config.feedInTariffs) ? [...this.config.feedInTariffs] : [];
        if (!consumptionRows.length) {
            return;
        }

        let changed = false;

        const saveTariffs = async () => {
            if (!changed) {
                return;
            }

            const objId = `system.adapter.${this.namespace}`;
            const instanceObj = await this.getForeignObjectAsync(objId);
            if (!instanceObj || !instanceObj.native) {
                return;
            }

            instanceObj.native.tariffs = consumptionRows;
            instanceObj.native.feedInTariffs = feedInRows;
            await this.setForeignObjectAsync(objId, instanceObj);
            this.config.tariffs = consumptionRows;
            this.config.feedInTariffs = feedInRows;
            changed = false;
        };

        const currentTariff = getCurrentTariff({ ...this.config, tariffs: consumptionRows }, now);
        if (currentTariff) {
            const currentIndex = findTariffIndexByStartDate({ ...this.config, tariffs: consumptionRows }, currentTariff.start);
            if (currentIndex >= 0) {
                const rawCurrentTariff = consumptionRows[currentIndex];
                const hasConsumptionStart = String(rawCurrentTariff.startzaehlerstand_bezug || '').trim() !== '';
                const shouldSkipAutoSetForCounter = this.getSourceType() === 'counter' && currentMeter.consumption <= 0;

                if (!hasConsumptionStart && !shouldSkipAutoSetForCounter) {
                    rawCurrentTariff.startzaehlerstand_bezug = String(currentMeter.consumption);
                    changed = true;
                    this.log.info(`Start meter reading set automatically for active consumption tariff ${rawCurrentTariff.name || fmtDate(currentTariff.start)} (${fmtDate(currentTariff.start)})`);
                }
            }

            const nextStart = addYears(currentTariff.start, 1);
            if (dateKey(now) >= dateKey(nextStart)) {
                const existingNextIndex = findTariffIndexByStartDate({ ...this.config, tariffs: consumptionRows }, nextStart);
                if (existingNextIndex < 0) {
                    consumptionRows.push({
                        aktiv: true,
                        name: currentTariff.name || 'Consumption tariff',
                        startdatum: fmtDate(nextStart),
                        startzaehlerstand_bezug: '',
                        grundgebuehr: String(currentTariff.grundgebuehr),
                        arbeitspreis: String(currentTariff.arbeitspreis),
                        abschlag: String(currentTariff.abschlag),
                        abschlagTag: currentTariff.abschlagTag,
                    });
                    changed = true;
                    this.log.info(`Follow-up consumption tariff created automatically: ${fmtDate(nextStart)}`);
                }
            }
        }

        if (this.getSourceType() === 'dual_meter' && feedInRows.length) {
            const currentFeedInTariff = getCurrentFeedInTariff({ ...this.config, feedInTariffs: feedInRows }, now);
            if (currentFeedInTariff) {
                const currentFeedIndex = findFeedInTariffIndexByStartDate({ ...this.config, feedInTariffs: feedInRows }, currentFeedInTariff.start);
                if (currentFeedIndex >= 0) {
                    const rawCurrentFeedInTariff = feedInRows[currentFeedIndex];
                    const hasFeedInStart = String(rawCurrentFeedInTariff.startzaehlerstand_einspeisung || '').trim() !== '';
                    if (!hasFeedInStart) {
                        rawCurrentFeedInTariff.startzaehlerstand_einspeisung = String(currentMeter.feedIn);
                        changed = true;
                        this.log.info(`Start meter reading set automatically for active feed-in tariff ${rawCurrentFeedInTariff.name || fmtDate(currentFeedInTariff.start)} (${fmtDate(currentFeedInTariff.start)})`);
                    }
                }

                const nextFeedInStart = addYears(currentFeedInTariff.start, 1);
                if (dateKey(now) >= dateKey(nextFeedInStart)) {
                    const existingNextFeedIndex = findFeedInTariffIndexByStartDate({ ...this.config, feedInTariffs: feedInRows }, nextFeedInStart);
                    if (existingNextFeedIndex < 0) {
                        feedInRows.push({
                            aktiv: true,
                            name: currentFeedInTariff.name || 'Feed-in tariff',
                            startdatum: fmtDate(nextFeedInStart),
                            startzaehlerstand_einspeisung: '',
                            einspeiseverguetung: String(currentFeedInTariff.einspeiseverguetung),
                            abschlag: String(currentFeedInTariff.abschlag),
                            abschlagTag: currentFeedInTariff.abschlagTag,
                            eegAutomatik: !!currentFeedInTariff.eegAutomatik,
                            eegInbetriebnahme: currentFeedInTariff.eegInbetriebnahme || '',
                            eegEinspeiseart: currentFeedInTariff.eegEinspeiseart || 'surplus',
                            eegAnlagenart: currentFeedInTariff.eegAnlagenart || 'building',
                            eegAnlagenleistung: String(currentFeedInTariff.eegAnlagenleistung || ''),
                        });
                        changed = true;
                        this.log.info(`Follow-up feed-in tariff created automatically: ${fmtDate(nextFeedInStart)}`);
                    }
                }
            }
        }

        await saveTariffs();
    }

    
    async handleValueUpdate(meterValues) {
        const todayKey = dateKey(new Date());
        if (this.getSourceType() === 'counter') {
            const rawValue = await this.readCurrentInputRawValue();
            const detectedType = await this.getDetectedCounterType(rawValue);
            if (detectedType === 'numeric') {
                const counterValue = parseNum(rawValue, 0);
                await this.setStateAsync('consumption.counter', { val: counterValue, ack: true });
            } else {
                const pulses = await this.getPulseTotal();
                await this.setStateAsync('consumption.counter', { val: pulses, ack: true });
            }
        } else {
            await this.setStateAsync('consumption.counter', { val: 0, ack: true });
        }

        const dayStartConsumptionState = await this.getStateAsync('_intern.day_start_consumption');
        const dayStartFeedInState = await this.getStateAsync('_intern.day_start_feedin');
        const dayStartDateState = await this.getStateAsync('_intern.day_start_date');
        const ledgerState = await this.getStateAsync('_intern.ledger_json');

        const dayStartValues = {
            consumption: dayStartConsumptionState ? parseNum(dayStartConsumptionState.val, meterValues.consumption) : meterValues.consumption,
            feedIn: dayStartFeedInState ? parseNum(dayStartFeedInState.val, meterValues.feedIn) : meterValues.feedIn,
        };
        const dayStartDate = dayStartDateState && dayStartDateState.val ? String(dayStartDateState.val) : todayKey;

        let ledger = {};
        if (ledgerState && ledgerState.val) {
            try { ledger = JSON.parse(String(ledgerState.val)); } catch { ledger = {}; }
        }

        if (dayStartDate !== todayKey) {
            ledger = closePreviousDay(dayStartValues, meterValues, dayStartDate, ledger);
            await this.setStateAsync('_intern.ledger_json', { val: JSON.stringify(ledger), ack: true });
            await this.setStateAsync('_intern.day_start_consumption', { val: meterValues.consumption, ack: true });
            await this.setStateAsync('_intern.day_start_feedin', { val: meterValues.feedIn, ack: true });
            await this.setStateAsync('_intern.day_start_date', { val: todayKey, ack: true });
        }

        await this.handleMonthRollover(meterValues);
        await this.handleAutoCreateNextTariff(meterValues);

        const currentDayStartConsumptionState = await this.getStateAsync('_intern.day_start_consumption');
        const currentDayStartFeedInState = await this.getStateAsync('_intern.day_start_feedin');
        const currentMonthStartConsumptionState = await this.getStateAsync('_intern.month_start_consumption');
        const currentMonthStartFeedInState = await this.getStateAsync('_intern.month_start_feedin');

        const currentDayStarts = {
            consumption: currentDayStartConsumptionState ? parseNum(currentDayStartConsumptionState.val, meterValues.consumption) : meterValues.consumption,
            feedIn: currentDayStartFeedInState ? parseNum(currentDayStartFeedInState.val, meterValues.feedIn) : meterValues.feedIn,
        };
        const currentMonthStarts = {
            consumption: currentMonthStartConsumptionState ? parseNum(currentMonthStartConsumptionState.val, meterValues.consumption) : meterValues.consumption,
            feedIn: currentMonthStartFeedInState ? parseNum(currentMonthStartFeedInState.val, meterValues.feedIn) : meterValues.feedIn,
        };

        const values = buildOutputValues(this.config, meterValues, currentDayStarts, ledger, currentMonthStarts);
        for (const [id, val] of Object.entries(values)) {
            await this.setStateAsync(id, { val, ack: true });
        }
    }

    onUnload(callback) {
        try {
            if (this.refreshTimer) {
                this.clearInterval(this.refreshTimer);
                this.refreshTimer = null;
            }
            this.ownStateIds = new Set(['consumption.meter_reading', 'feedin.meter_reading']);
            callback();
        } catch {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = options => new EnergyElectricity(options);
} else {
    new EnergyElectricity();
}
