import { useMemo } from 'react';

interface CodeViewerProps {
  code: string;
}

interface HighlightToken {
  value: string;
  kind: 'comment' | 'string' | 'keyword' | 'builtin' | 'number' | 'operator' | 'plain' | 'space';
}

const KEYWORDS = new Set([
  'as',
  'break',
  'case',
  'const',
  'context',
  'createMachine',
  'create',
  'default',
  'enum',
  'event',
  'export',
  'from',
  'function',
  'if',
  'import',
  'interface',
  'let',
  'return',
  'switch',
  'type',
]);

const BUILT_INS = new Set(['Record', 'unknown', 'string', 'number', 'boolean', 'void']);

const TOKEN_PATTERN =
  /\/\/.*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][A-Za-z0-9_$]*\b|[{}()[\],.;:+\-*/<>=!&|%^~?#]+|\s+/g;

function classifyToken(token: string): HighlightToken['kind'] {
  if (!token) {
    return 'plain';
  }

  if (/^\s+$/.test(token)) {
    return 'space';
  }

  if (token.startsWith('//') || token.startsWith('/*')) {
    return 'comment';
  }

  if (
    token.startsWith('"') ||
    token.startsWith("'") ||
    token.startsWith('`')
  ) {
    return 'string';
  }

  if (KEYWORDS.has(token)) {
    return 'keyword';
  }

  if (BUILT_INS.has(token)) {
    return 'builtin';
  }

  if (/^\d/.test(token)) {
    return 'number';
  }

  if (/^[{}()[\],.;:+\-*/<>=!&|%^~?#]+$/.test(token)) {
    return 'operator';
  }

  return 'plain';
}

function tokenizeLine(line: string): HighlightToken[] {
  const matches = line.match(TOKEN_PATTERN);
  if (!matches) {
    return [{ value: line, kind: 'plain' }];
  }

  return matches.map((value) => ({
    value,
    kind: classifyToken(value),
  }));
}

export function CodeViewer({ code }: CodeViewerProps) {
  const lines = useMemo(() => code.replace(/\r\n?/g, '\n').split('\n'), [code]);
  const highlighted = useMemo(() => lines.map((line) => tokenizeLine(line)), [lines]);

  return (
    <pre className="code-viewer" aria-label="Generated code">
      {highlighted.map((tokens, lineIndex) => (
        <div className="code-line" key={`line-${lineIndex}`}>
          <span className="code-line-number">{lineIndex + 1}</span>
          <span className="code-line-content">
            {tokens.length === 0 ? (
              <span className="code-token-space">&nbsp;</span>
            ) : (
              tokens.map((token, tokenIndex) => (
                <span
                  key={`token-${lineIndex}-${tokenIndex}`}
                  className={`code-token code-token-${token.kind}`}
                >
                  {token.value}
                </span>
              ))
            )}
          </span>
        </div>
      ))}
    </pre>
  );
}
