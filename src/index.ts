import dotenv from "dotenv";
import { run as tradeWithPk } from "./tradeWithPk";
import { run as tradeWithProvider } from "./tradeWithProvider";
dotenv.config();

async function main() {
  // console.log("1) Trade with PK");
  // await tradeWithPk();
  // console.log("Done 🎉\n");

  console.log("2) Trade with Provider");
  await tradeWithProvider();
  console.log("Done 🎉\n");
}

main().catch(console.error);
