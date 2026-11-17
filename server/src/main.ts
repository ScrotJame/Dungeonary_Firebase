import {buildServer, initFirebase, shutdownHandler} from "./server";

const port = Number(process.env.PORT ?? 10000);
const server = buildServer(initFirebase()).listen(port, "0.0.0.0", () => {
  console.log(`listening on ${port}`);
});
process.on("SIGTERM", shutdownHandler(server, (code) => process.exit(code)));
