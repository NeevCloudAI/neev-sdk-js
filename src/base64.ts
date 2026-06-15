// Decodes a base64 string to bytes using the runtime's global atob. Shared by the
// exec and process follow-stream NDJSON parsers, which carry base64 output chunks.
export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
