# Heat Map Add-In

Heat Map is a MyGeotab Add-In for visualizing vehicle location history and rule violations on an interactive Leaflet heat map. The heat layer remains the primary view, while rule-specific event markers and measurements are available through an optional detail overlay.

Current version: **1.0.31**

## Features

- Location-history heat maps from Geotab `LogRecord` GPS data.
- Exception-history heat maps from `ExceptionEvent` and associated `LogRecord` data.
- Multiple vehicle and exception-rule selection.
- Quick ranges for today, yesterday, this week, last week, this month, and last month.
- Event totals showing events currently in view and total records loaded.
- A clean heat-map-first result with no markers obscuring the heat colouring.
- A top-right legend showing each selected exception rule, colour, and event count.
- An optional **Show event details** overlay with colour-coded dots, collision-limited labels, hover text, and clickable event information.
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

## Installation

In MyGeotab, open **System Settings → Add-Ins**, enable unsigned Add-Ins if required, and add this configuration:

```json
{
  "name": "Heat Map",
  "supportEmail": "francis@directt.co.nz",
  "version": "1.0.31",
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
