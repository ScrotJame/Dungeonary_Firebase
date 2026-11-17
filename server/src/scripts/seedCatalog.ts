import {deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {seedCatalog} from "../data/catalogSeed";
import {initFirebase} from "../server";

// npm --prefix server run seed:catalog [-- --apply]
// Cần FIREBASE_SERVICE_ACCOUNT_JSON, hoặc FIRESTORE_EMULATOR_HOST khi thử trên máy.
const app = initFirebase();

// Chỉ in tên đích, không in gì khác từ khoá.
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (emulatorHost) {
  console.log(`Đích: emulator ${emulatorHost} (project ${process.env.GCLOUD_PROJECT ?? "demo-dungeonary"})`);
} else {
  const {project_id: projectId} = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "{}") as {
    project_id?: string;
  };
  console.log(`Đích: project ${projectId} (production)`);
}

seedCatalog(getFirestore(app), {apply: process.argv.includes("--apply")})
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => deleteApp(app));
