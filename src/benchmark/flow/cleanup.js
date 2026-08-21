function redact(message, { code, token }) {
  let result = String(message);
  for (const secret of [code, token]) if (secret) result = result.split(secret).join("[REDACTED]");
  return result.replace(/(bearer\s+)\S+/giu, "$1[REDACTED]");
}

export async function validateCleanup(remove, credentials) {
  let receipt;
  try { receipt = await remove(credentials); }
  catch (error) { throw new Error(redact(`cleanup request failed: ${error.message ?? error}`, credentials)); }
  if (!receipt || receipt.status < 200 || receipt.status >= 300) {
    throw new Error(redact(`cleanup deletion was not accepted (status=${receipt?.status ?? "none"}; body=${receipt?.body ?? ""})`, credentials));
  }
  return receipt;
}

export async function closeContexts(contexts) {
  const results = await Promise.allSettled(contexts.map((context) => context.close()));
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  return true;
}
