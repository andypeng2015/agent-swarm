export function contentSha256(content: string): string {
  return new Bun.CryptoHasher("sha256").update(content).digest("hex");
}
