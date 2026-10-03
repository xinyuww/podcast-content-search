/** Inspect file bytes: the download cache's .mp3 suffix is not authoritative. */
export function detectAudioFormat(header) {
  if (header.length >= 12 && header.toString("ascii", 4, 8) === "ftyp") {
    return { extension: "m4a", contentType: "audio/mp4" };
  }
  if (header.toString("ascii", 0, 3) === "ID3" ||
      (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0 && (header[1] & 0x06) !== 0)) {
    return { extension: "mp3", contentType: "audio/mpeg" };
  }
  throw new Error("Unsupported audio container; inspect the original before publishing");
}
