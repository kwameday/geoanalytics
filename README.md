# Telecel Marketplace Geo Analytics Dashboard

Static web dashboard for merchants geographic analytics.

## How updates work
1. Replace `data/current_map_data.csv` with your latest exported map data, or use the in-app upload button.
2. If your catchment changes, edit the Greater Accra bounding box in `app.js`.
3. If you want different zone logic, edit the `ZONES` array in `app.js`.
4. If you want different GMV assumptions or target category mix, edit `DEFAULT_CONFIG.monthlyGMV` and `DEFAULT_CONFIG.targetMix` in `app.js`.
