![Logo](admin/energygas.png)
# ioBroker.energy-electricity

Strom-Adapter auf Basis von `ioBroker.energy-gas` für Netzbezug, Einspeisung und Counter-Szenarien.

## Funktionen

- Stromverbrauch aus Verbrauchszähler
- Einspeisung aus separatem Einspeisezähler
- Counter-Modus bleibt erhalten und berechnet nur den Verbrauch
- Tarife mit:
  - Grundgebühr
  - Bezugspreis pro kWh
  - Einspeisevergütung pro kWh
  - Abschlag und Zahlungstag
- Tages-, Monats- und Abrechnungsjahrwerte
- automatische Folgetarife
- automatisches Setzen fehlender Startzählerstände beim aktiven Tarif

## Eingangsarten

1. **Verbrauchszähler + Einspeisezähler**
2. **Nur Verbrauchszähler**
3. **Counter (nur Verbrauch)**

## Wichtige States

- `consumption.meter_reading`
- `verbrauch.counter`
- `feedin.meter_reading`
- `today.*`
- `yesterday.*`
- `month.*`
- `last_month.*`
- `billing_year.*`
- `last_billing_year.*`

## Stand dieser Version

Diese Version ist gegenüber der ersten Basis robuster bei:

- Tarifwechseln mit getrennten Startzählerständen für Bezug und Einspeisung
- fehlenden Startwerten im Folgetarif
- manueller Korrektur im Counter-Modus

## Hinweis

Vor produktivem Einsatz solltest du vor allem diese Fälle einmal durchtesten:

- Tarifwechsel an einem Stichtag
- Monatswechsel
- Counter numerisch
- Counter boolean / Impuls
- Betrieb ohne Einspeisezähler


## Separate feed-in billing

The adapter supports a dedicated feed-in tariff table with its own start date, feed-in meter start value, feed-in compensation per kWh and an optional monthly advance payment from the grid operator.
