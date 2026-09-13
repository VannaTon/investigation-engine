function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, "<num>")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeError(message: string, stackTrace?: string): string {
  const normalizedMessage = normalizeText(message);

  if (!stackTrace) {
    return normalizedMessage;
  }

  return `${normalizedMessage}\n${normalizeText(stackTrace)}`;
}
