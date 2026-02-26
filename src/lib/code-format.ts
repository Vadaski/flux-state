const INDENT = '  ';

function normalizeLineEndings(code: string): string {
  return code.replace(/\r\n?/g, '\n');
}

function shouldDecreaseIndent(line: string): boolean {
  return /^[}\])]/.test(line);
}

function shouldIncreaseIndent(line: string): boolean {
  return /[{[(],?$/.test(line);
}

export function formatGeneratedCode(code: string): string {
  const normalized = normalizeLineEndings(code);
  const rawLines = normalized.split('\n');
  const formatted: string[] = [];
  let indentLevel = 0;
  let previousBlank = false;

  for (const rawLine of rawLines) {
    const line = rawLine.trim();

    if (!line) {
      if (!previousBlank && formatted.length > 0) {
        formatted.push('');
      }
      previousBlank = true;
      continue;
    }

    previousBlank = false;

    if (shouldDecreaseIndent(line)) {
      indentLevel = Math.max(indentLevel - 1, 0);
    }

    formatted.push(`${INDENT.repeat(indentLevel)}${line}`);

    if (shouldIncreaseIndent(line)) {
      indentLevel += 1;
    }
  }

  return formatted.join('\n');
}
