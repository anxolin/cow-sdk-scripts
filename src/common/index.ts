export function getPk() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error("PRIVATE_KEY is not set");
  }

  return pk;
}
