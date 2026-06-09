import { syncAllSheets } from "../services/sheetFetcher.js";

syncAllSheets()
  .then((result) => {
    console.log(`Sync terminé: ${result.dailyPicks.length} picks @ ${result.syncedAt}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
