export const PRIZE_SYMBOL = process.env.NEXT_PUBLIC_PRIZE_SYMBOL || "USDC";
export const PRIZE_DECIMALS = Number(process.env.NEXT_PUBLIC_PRIZE_DECIMALS || 6);
// Circle's official devnet USDC by default (free at faucet.circle.com).
export const PRIZE_MINT = process.env.NEXT_PUBLIC_PRIZE_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const OWN_FAUCET = process.env.NEXT_PUBLIC_OWN_FAUCET === "1";
export const CLUSTER = (process.env.NEXT_PUBLIC_RPC_URL || "devnet").includes("mainnet") ? "mainnet-beta" : "devnet";

export function fromBase(amount: string | bigint, decimals = PRIZE_DECIMALS) {
  const v = typeof amount === "bigint" ? amount : BigInt(amount || "0");
  const whole = v / 10n ** BigInt(decimals);
  const frac = v % 10n ** BigInt(decimals);
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 2);
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function toBase(amount: string, decimals = PRIZE_DECIMALS) {
  const [w, f = ""] = amount.trim().split(".");
  if (!/^\d+$/.test(w || "0") || !/^\d*$/.test(f)) throw new Error("Enter a number like 25 or 12.50");
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export const money = (base: string | bigint, decimals?: number) => `${fromBase(base, decimals)} ${PRIZE_SYMBOL}`;

export const short = (addr: string, n = 4) => (addr.length > n * 2 + 1 ? `${addr.slice(0, n)}…${addr.slice(-n)}` : addr);

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=${CLUSTER}`;

export function splitLabel(bps: number[]) {
  return bps.map((b) => `${b / 100}%`).join(" / ");
}
