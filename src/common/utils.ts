import inquirer from "inquirer";

export function getPk() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error("PRIVATE_KEY is not set");
  }

  return pk;
}

export async function confirm(message: string): Promise<boolean> {
  const { confirmed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message,
      default: false,
    },
  ]);

  return confirmed;
}

export const jsonReplacer = (key: string, value: any) => {
  // Handle BigInt
  if (typeof value === "bigint") {
    return value.toString();
  }
  // Handle BigNumber (if you're using ethers.BigNumber)
  if (value?._isBigNumber) {
    return value.toString();
  }
  return value;
};
