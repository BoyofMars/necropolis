// Start `next dev` with web/ as the working directory, wherever this is launched from.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const webDir = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(webDir);
process.argv = [process.argv[0], "next", "dev", "-p", process.env.PORT ?? "3000"];
createRequire(import.meta.url)("next/dist/bin/next");
