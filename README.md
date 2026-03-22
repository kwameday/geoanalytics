# Marketplace Geo Analytics Dashboard

Static web dashboard ready for GitHub and Cloudflare Pages.

## Files
- `index.html` – main app shell
- `styles.css` – styling
- `app.js` – zone logic, scoring model, GMV model, CSV upload logic
- `data/current_map_data.csv` – bundled sample dataset

## Expected input CSV structure
Your refresh file should include these columns:
- `Name`
- `Category`
- `Latitude`
- `Longitude`

## How updates work
1. Replace `data/current_map_data.csv` with your latest exported map data, or use the in-app upload button.
2. If your catchment changes, edit the Greater Accra bounding box in `app.js`.
3. If you want different zone logic, edit the `ZONES` array in `app.js`.
4. If you want different GMV assumptions or target category mix, edit `DEFAULT_CONFIG.monthlyGMV` and `DEFAULT_CONFIG.targetMix` in `app.js`.

## GitHub + Cloudflare Pages deployment
1. Create a new GitHub repo.
2. Upload all files in this folder to the repo root.
3. In Cloudflare Pages, create a new project and connect that GitHub repo.
4. Framework preset: `None`
5. Build command: leave blank
6. Build output directory: `/`
7. Deploy.

Because this is a plain static site, Cloudflare Pages will publish it directly without a build step.

## Notes
- The dashboard filters out rows outside the active study area to prevent outlier branches from distorting Accra zone scoring.
- The next-500 plan is slot-based. If you later add a prospect pipeline with merchant names, you can extend the app to match each recommended slot to a specific lead.
