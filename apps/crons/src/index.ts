import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPropertiesVolumeSecrets } from "@hmcts-cft/cloud-native-platform";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chartPath = path.join(__dirname, "../helm/values.yaml");

export const main = async () => {
  // No `omit`: it listed `DATABASE_URL`, which the chart no longer maps because this repo has no
  // database. See `apps/web/src/secrets.ts` for what `omit` is for — a developer running against a real
  // vault, whose local session store the deployed one must not silently replace. Nothing crons reads has
  // that problem.
  await getPropertiesVolumeSecrets({ chartPath });
  const scriptName = process.env.SCRIPT_NAME;

  if (!scriptName) {
    throw new Error("SCRIPT_NAME environment variable is required.");
  }

  const script = await import(`./${scriptName}.js`);

  if (script && typeof script.default === "function") {
    await script.default();
  } else {
    throw new Error(`The script "${scriptName}" does not export a default function.`);
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Cron job failed:", error);
    process.exit(1);
  });
}
