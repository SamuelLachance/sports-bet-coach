const files = new Map<string, string>();

function keyFor(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

export async function mkdir(): Promise<void> {}

export async function writeFile(filePath: string, data: string): Promise<void> {
  files.set(keyFor(filePath), data);
}

export async function readFile(filePath: string): Promise<string> {
  const value = files.get(keyFor(filePath));
  if (value === undefined) {
    const err = new Error(`ENOENT: ${filePath}`) as Error & { code?: string };
    err.code = "ENOENT";
    throw err;
  }
  return value;
}

const fs = { mkdir, writeFile, readFile };
export default fs;
