# Heat Map Add-In

Heat Map is a MyGeotab Add-In for visualizing vehicle location history and rule violations on an interactive Leaflet heat map. The heat layer remains the primary view, while rule-specific event markers and measurements are available through an optional detail overlay.

Current version: **1.0.42**

## Features

- Location-history heat maps from Geotab `LogRecord` GPS data.
- Exception-history heat maps from `ExceptionEvent` and associated `LogRecord` data.
- Multiple vehicle and exception-rule selection.
- Quick ranges for today, yesterday, this week, last week, this month, and last month.
- Event totals showing events currently in view and total records loaded.
- A clean heat-map-first result with no markers obscuring the heat colouring.
- A top-right legend showing each selected exception rule and its event count.
- An optional **Show event details** overlay whose dots, labels, and callout lines use each vehicle's colour from the vehicle legend, with collision-limited labels, hover text, and clickable event information.
- A top bar holding the date range, quick ranges, the action buttons, the status line, and the event totals readout.
- A single-page layout that fits the viewport: only the controls column scrolls, and the map fills the remaining height.
- An optional **Show speed limit zones** overlay of the NZTA speed limit zones, selectable by posted limit (10&ndash;110 km/h), which flags events that exceed the limit of the zone they fall inside and can restrict the mapped events to those zones.
- A **Weight History** mode that maps recorded cargo weight against the axle scale register.
- A **Live monitor** that polls current vehicle positions on the same map and flags speed, payload and new-exception alerts, drawing each live load as a roundel of current tonnes over its register limit, labelling the vehicle with its weight and speed, and optionally zooming to a vehicle as it starts alerting.
- A selectable **Data source**: history can be read from a local cache (the pre-generated `cache-index.js` plus `months/YYYY-MM.js` aggregate files served by the local cache viewer) instead of the MyGeotab API, with the cache's coverage and build time shown. Weight history and the live monitor always read MyGeotab, and cache mode plots day/grid-cell heat only, so event details, speed bands, ring-fencing and the per-event print table need the API source.
- Colour-coded control sections and legend rows so speeding, idling, other exceptions, weight, speed zones, the live monitor and the data source read apart at a glance.
- A progress bar centred over the map while data loads.
- Daily browser caching and spatial compaction for faster repeat queries.
- TDG Environmental branding.
- Direct Track branding in the map's top-right corner.

## Rule-Specific Metrics

| Rule type | Map label | Source |
| --- | --- | --- |
| Speeding | Peak amount above the posted limit in km/h | `LogRecord.speed` compared with `GetPostedRoadSpeedsForDevice` |
| Idling and time-based rules | Exception duration | `ExceptionEvent.activeFrom` and `activeTo` |
| Harsh acceleration or braking | Peak longitudinal g-force | Calculated from timestamped GPS speed changes |
| Harsh cornering | Peak lateral g-force | Calculated from GPS speed and heading changes |
| Other rules | Duration, with distance in the popup when available | `ExceptionEvent` |

Calculated g-force is an estimate based on available GPS samples, not a raw accelerometer measurement. If an event contains insufficient samples, the marker falls back to duration and the popup states that g-force is unavailable.

## Speed Limit Zones

Ticking **Show speed limit zones** overlays the zones published in the [NZTA National Speed Limit Register](https://opendata-nzta.opendata.arcgis.com/), using the `SpeedLimitZoneFull` view. The category picker is the limit a zone enforces, so 10, 20, 30 … 110 km/h zones can be shown in any combination; each limit has its own colour, and 30, 40, 50 and 100 are selected by default. A variable zone enforces its minimum during the posted period, so it is matched on `speedLimitZoneMinValue` (a 50 km/h street with a 40 km/h school period counts as 40); zones without a minimum fall back to `speedLimitZoneValue`. When a view holds none of the selected limits the status line names them so the empty overlay is not mistaken for a failure. **School zones only** narrows the selection to `speedLimitZoneReasonName = 'The presence of a school'` (about 6,800 zones nationally), which are drawn with a solid, thicker outline.

**Only events inside the selected zones** restricts the mapped events — speeding and every other exception type — to the zones currently loaded, and the event totals follow the same filter. The zone legend counts the events inside the zones and how many exceed the zone limit.

- Only the zones intersecting the current map view are requested, and the overlay reloads as the map is panned once the zoom is 11 or closer. Zones already fetched stay cached in the page; changing the selected categories clears that cache.
- Mapped events inside a zone report the zone limit on their sign instead of the posted road limit (yellow surround for school zones), and their popup names the zone, its reason and its period of operation.
- Variable zones publish their reduced limit as the minimum value (for example the 40 km/h school-hours limit inside a 50 km/h street), so that value is what zone speeding is measured against. The register does not expose machine-readable operating hours, so an event is flagged on location and speed alone — the tooltip shows the posted period so it can be checked before acting on the event.
- The zone data is fetched from `services.arcgis.com` at runtime. If a browser or network policy blocks that host, the control reports the failure and the rest of the Add-In continues to work.

## Weight History

Weight History is the third **Visualize by** mode. For the selected vehicles and date range it reads the cargo weight diagnostic (`StatusData`, resolved by the diagnostic named like `%cargo weight%`) in six-hour windows, and places each reading on the map using the nearest `LogRecord` position within five minutes.

- Consecutive readings at or above the warning level become a single weight event carrying the peak weight, the reading count and the duration, so a loaded vehicle is one marker rather than hundreds.
- Limits come from `scripts/weight-register.js`, keyed on the asset name with punctuation removed: the GML payload is the alert limit and `GVM - tare` is the critical limit. Vehicles missing from the register use the **Fallback payload limit**, and the status line names how many vehicles that applied to.
- **Warn at %** sets how close to the limit counts as approaching it (80% by default).
- Each vehicle's five worst loads (by percentage of limit) carry a `#1`&ndash;`#5` badge and a highlighted ring, and **Only the top 5 overloads per vehicle** narrows the map, totals, legend and printed table to those.
- The printed report gains **Cargo** and **% of limit** columns, plus peak cargo per vehicle in the summary table.
- The register ships as a file in the bundle, so it must be re-uploaded when the register changes.

## Live Monitor

Live monitoring is a separate section that draws on the same Leaflet map in its own layer, so historical results stay visible underneath it. MyGeotab exposes no push channel to an Add-In, so this polls: freshness is bounded by the chosen interval (30 seconds to 5 minutes), not instant.

- Positions and speeds come from `DeviceStatusInfo`, live cargo weight from the last hour of the weight diagnostic, and new exceptions from `GetFeed` on `ExceptionEvent`, which uses the feed's version cursor so no event is missed or repeated.
- A vehicle alerts when it is at or above the **Alert over km/h** threshold, over its payload limit, or has raised an exception for the selected rules in the last 15 minutes. Alerting markers pulse, are labelled, and are listed with their time; **Show alerting vehicles only** hides the rest.
- Polling stops while the browser tab is hidden and when the Add-In loses focus, and resumes on focus.

## Installation

In MyGeotab, open **System Settings → Add-Ins**, enable unsigned Add-Ins if required, and add this configuration:

```json
{
  "name": "Heat Map",
  "supportEmail": "francis@directt.co.nz",
  "version": "1.0.42",
  "items": [
    {
      "url": "https://kikorangee.github.io/sdk-addin-samples/addin-heatmap/dist/heatmap31.html",
      "category": "SafetyId",
      "menuName": {
        "en": "Heat Map Analytics"
      },
      "icon": "https://kikorangee.github.io/sdk-addin-samples/addin-heatmap/dist/images/icon.svg"
    }
  ],
  "isSigned": false
}
```

### Hosting the files inside MyGeotab

To avoid depending on GitHub Pages, MyGeotab can host the files in the database itself. Build the flattened bundle:

```bash
./tools/build-hosted-zip.sh
```

This writes `build/heatmap-addin-<version>-mygeotab-hosted.zip`, which contains every asset in one flat folder (MyGeotab keeps uploaded files in a single namespace, so the HTML references bare file names) plus a `config.json` whose `url` and `icon` are relative.

In MyGeotab: **System Settings → Add-Ins → + Add-In**, paste the bundled `config.json` into the *Configuration* tab, then upload the remaining files on the *Files* tab, click **Done**, and **Save**. Re-upload the files after every change, since the database keeps its own copy.

## Upgrading

`dist/scripts/main.js` is shared by every `dist/heatmap*.html` page and expects the controls of the current page. After deploying a new page, update the `url` in the MyGeotab Add-In configuration to match, then hard-refresh MyGeotab. An older page left in the configuration loads but cannot bind its controls; it now shows an out-of-date banner naming the missing controls instead of failing silently.

## Usage

1. Choose **Location History** or **Exception History**.
2. For exception history, select one or more rules using Ctrl/Command+Click.
3. Select one or more vehicles.
4. Choose a quick range or enter custom dates.
5. Select **Show Results**.
6. Review the heat-map intensity and exception counts in the top-right legend.
7. Enable **Show event details** only when individual events need to be inspected.
8. Hover over a coloured event dot for its rule and measurement, or click it for the vehicle, timestamp, duration, and distance.

The Add-In limits a query to 100 vehicle/rule combinations and the optional overlay to 500 event markers. Persistent measurement labels are collision-limited and increase gradually as the map is zoomed in. The heat layer still represents all returned log records within the configured API result limits.

## Data and Permissions

The Add-In runs entirely inside MyGeotab and uses the current user's API session. Vehicle, rule, exception, GPS, and posted-road-speed results therefore respect that user's database permissions and group filter.

Primary API data:

- `Device` and `Rule` populate selectors.
- `LogRecord` supplies GPS coordinates, timestamps, and vehicle speed.
- `ExceptionEvent` supplies violation windows, duration, distance, device, and rule references.
- `GetPostedRoadSpeedsForDevice` supplies posted speed-limit changes.

Historical daily results are cached in IndexedDB for up to 30 days. The current day's cache expires after five minutes.

## Live Validation

Version 1.0.14 was tested in the Hydrotech MyGeotab database using vehicle `COM092` and the previous calendar month:

- Speeding: 3 events rendered with peak exceedances of `+11`, `+11`, and `+7 km/h`.
- Idling: 74 events rendered with duration labels, including `6m 25s`, `18m 36s`, and `1h 18m`.
- Harsh Braking (New): a measurable event rendered as `0.31 g`.
- A sparse harsh-braking event correctly fell back to duration rather than displaying a false zero g-force value.
- A combined Idling and Speeding query rendered 2,168 heat records while the default view contained zero event dots and zero measurement labels.
- The legend correctly reported 74 Idling exceptions and 3 Speeding exceptions.
- Enabling **Show event details** displayed all 77 colour-coded event dots with only six non-overlapping labels at the fitted zoom level; disabling it restored the clean heat map immediately without another API query.

## Project Structure

- `app/` contains the readable source files.
- `dist/` contains the production files served by GitHub Pages.
- `dist/config.json` contains the current MyGeotab installation configuration.

## Libraries

- [Leaflet](https://leafletjs.com/)
- [Leaflet.heat](https://github.com/Leaflet/Leaflet.heat)
- [MyGeotab JavaScript API](https://developers.geotab.com/myGeotab/apiReference/)
