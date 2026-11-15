import type { ReactNode } from 'react';

/** An order, request or quote code: never breaks at its hyphens (it moves to the next line whole). */
export function CodeText({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap">{children}</span>;
}

/** Renders a translated sentence with `code` kept unbroken (any language; the sentence stays one string). */
export function withCode(text: string, code: string): ReactNode {
  const at = code ? text.indexOf(code) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <CodeText>{code}</CodeText>
      {text.slice(at + code.length)}
    </>
  );
}
