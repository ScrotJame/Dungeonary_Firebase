import {deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {seedCatalog} from "../data/catalogSeed";
import {initFirebase} from "../server";

// npm --prefix server run seed:catalog [-- --apply]
// Cần FIREBASE_SERVICE_ACCOUNT_JSON, hoặc FIRESTORE_EMULATOR_HOST khi thử trên máy.
const app = initFirebase();
seedCatalog(getFirestore(app), {apply: process.argv.includes("--apply")})
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => deleteApp(app));
