import {buildServer, initFirebase} from "./server";

const port = Number(process.env.PORT ?? 10000);
buildServer(initFirebase()).listen(port, "0.0.0.0", () => {
  console.log(`listening on ${port}`);
});
