const i18n = require('../admin/i18n/statetranslations.js');

/**
 * Ensures that all required adapter states exist.
 *
 * @param {ioBroker.Adapter} adapter Adapter instance used to create or update states.
 * @returns {Promise<void>}
 */
async function ensureStates(adapter) {
    const defs = [
        ['info.connection', 'info_connection', 'boolean', 'indicator.connected', ''],
        ['consumption.meter_reading', 'consumption_meter_reading', 'number', 'value', 'kWh', true],
        ['consumption.counter', 'consumption_counter', 'number', 'value', ''],
        ['feedin.meter_reading', 'feedin_meter_reading', 'number', 'value', 'kWh', true],
        ['feedin.eeg_auto_active', 'eeg_auto_active', 'boolean', 'indicator', ''],

        ['today.consumption', 'today_consumption', 'number', 'value', 'kWh'],
        ['today.feedin', 'today_feedin', 'number', 'value', 'kWh'],
        ['today.costs', 'today_costs', 'number', 'value', '€'],
        ['today.revenue', 'today_revenue', 'number', 'value', '€'],
        ['today.payments', 'today_payments', 'number', 'value', '€'],
        ['today.balance', 'today_balance', 'number', 'value', '€'],

        ['yesterday.consumption', 'yesterday_consumption', 'number', 'value', 'kWh'],
        ['yesterday.feedin', 'yesterday_feedin', 'number', 'value', 'kWh'],
        ['yesterday.costs', 'yesterday_costs', 'number', 'value', '€'],
        ['yesterday.revenue', 'yesterday_revenue', 'number', 'value', '€'],
        ['yesterday.payments', 'yesterday_payments', 'number', 'value', '€'],
        ['yesterday.balance', 'yesterday_balance', 'number', 'value', '€'],

        ['month.consumption', 'month_consumption', 'number', 'value', 'kWh'],
        ['month.feedin', 'month_feedin', 'number', 'value', 'kWh'],
        ['month.costs', 'month_costs', 'number', 'value', '€'],
        ['month.revenue', 'month_revenue', 'number', 'value', '€'],
        ['month.payments', 'month_payments', 'number', 'value', '€'],
        ['month.balance', 'month_balance', 'number', 'value', '€'],

        ['last_month.consumption', 'last_month_consumption', 'number', 'value', 'kWh'],
        ['last_month.feedin', 'last_month_feedin', 'number', 'value', 'kWh'],
        ['last_month.costs', 'last_month_costs', 'number', 'value', '€'],
        ['last_month.revenue', 'last_month_revenue', 'number', 'value', '€'],
        ['last_month.payments', 'last_month_payments', 'number', 'value', '€'],
        ['last_month.balance', 'last_month_balance', 'number', 'value', '€'],

        ['billing_year.consumption', 'billing_year_consumption', 'number', 'value', 'kWh'],
        ['billing_year.feedin', 'billing_year_feedin', 'number', 'value', 'kWh'],
        ['billing_year.costs', 'billing_year_costs', 'number', 'value', '€'],
        ['billing_year.revenue', 'billing_year_revenue', 'number', 'value', '€'],
        ['billing_year.payments', 'billing_year_payments', 'number', 'value', '€'],
        ['billing_year.balance', 'billing_year_balance', 'number', 'value', '€'],

        ['last_billing_year.consumption', 'last_billing_year_consumption', 'number', 'value', 'kWh'],
        ['last_billing_year.feedin', 'last_billing_year_feedin', 'number', 'value', 'kWh'],
        ['last_billing_year.costs', 'last_billing_year_costs', 'number', 'value', '€'],
        ['last_billing_year.revenue', 'last_billing_year_revenue', 'number', 'value', '€'],
        ['last_billing_year.payments', 'last_billing_year_payments', 'number', 'value', '€'],
        ['last_billing_year.balance', 'last_billing_year_balance', 'number', 'value', '€'],

        ['feedin_billing_year.feedin', 'feedin_billing_year_feedin', 'number', 'value', 'kWh'],
        ['feedin_billing_year.revenue', 'feedin_billing_year_revenue', 'number', 'value', '€'],
        ['feedin_billing_year.payments', 'feedin_billing_year_payments', 'number', 'value', '€'],
        ['feedin_billing_year.balance', 'feedin_billing_year_balance', 'number', 'value', '€'],

        ['last_feedin_billing_year.feedin', 'last_feedin_billing_year_feedin', 'number', 'value', 'kWh'],
        ['last_feedin_billing_year.revenue', 'last_feedin_billing_year_revenue', 'number', 'value', '€'],
        ['last_feedin_billing_year.payments', 'last_feedin_billing_year_payments', 'number', 'value', '€'],
        ['last_feedin_billing_year.balance', 'last_feedin_billing_year_balance', 'number', 'value', '€'],

        ['_intern.day_start_consumption', 'day_start_consumption', 'number', 'value', 'kWh'],
        ['_intern.day_start_feedin', 'day_start_feedin', 'number', 'value', 'kWh'],
        ['_intern.day_start_date', 'day_start_date', 'string', 'text', ''],
        ['_intern.ledger_json', 'ledger_json', 'string', 'json', ''],
        ['_intern.month_start_consumption', 'month_start_consumption', 'number', 'value', 'kWh'],
        ['_intern.month_start_feedin', 'month_start_feedin', 'number', 'value', 'kWh'],
        ['_intern.month_marker', 'month_marker', 'string', 'text', ''],
        ['_intern.counter_offset_consumption', 'counter_offset_consumption', 'number', 'value', 'kWh'],
        ['_intern.counter_last_raw', 'counter_last_raw', 'string', 'text', ''],
        ['_intern.counter_pulse_total', 'counter_pulse_total', 'number', 'value', ''],
        ['_intern.counter_detected_type', 'counter_detected_type', 'string', 'text', ''],
    ];

    for (const [id, key, type, role, unit, writeOverride] of defs) {
        const name = i18n[key] || { en: key };

        await adapter.extendObjectAsync(id, {
            type: 'state',
            common: {
                name,
                type,
                role,
                read: true,
                write: writeOverride === true || id.startsWith('_intern'),
                unit,
            },
            native: {},
        });
    }
}

module.exports = { ensureStates };