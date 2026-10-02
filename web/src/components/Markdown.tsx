import { Fragment, type ReactNode } from 'react';

/**
 * Minimal Markdown renderer producing React elements (never raw HTML), so agent-generated
 * content cannot inject scripts. Supports headings, lists, code blocks, tables, bold, inline code, links.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={`${keyBase}-${i++}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={`${keyBase}-${i++}`}>{tok.slice(1, -1)}</code>);
    else { const label = tok.slice(1, tok.indexOf(']')); out.push(<a key={`${keyBase}-${i++}`} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-accent underline">{label}</a>); }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = (text ?? '').replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0; let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const buf: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++; blocks.push(<pre key={k++}>{buf.join('\n')}</pre>); continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const lvl = h[1].length; const c = inline(h[2], `h${k}`); blocks.push(lvl === 1 ? <h1 key={k++}>{c}</h1> : lvl === 2 ? <h2 key={k++}>{c}</h2> : lvl === 3 ? <h3 key={k++}>{c}</h3> : <h4 key={k++}>{c}</h4>); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { if (!/^\s*\|[\s:-]+\|/.test(lines[i]) || /[a-z0-9]/i.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim())); i++; }
      const [head, ...body] = rows.filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
      blocks.push(<div key={k++} className="overflow-x-auto"><table><thead><tr>{head?.map((c, j) => <th key={j}>{inline(c, `th${k}${j}`)}</th>)}</tr></thead><tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `td${k}${ri}${j}`)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      const lis = items.map((it, j) => <li key={j}>{inline(it.replace(/^\[( |x)\]\s*/i, (_, c) => (c.trim() ? '☑ ' : '☐ ')), `li${k}${j}`)}</li>);
      blocks.push(ordered ? <ol key={k++}>{lis}</ol> : <ul key={k++}>{lis}</ul>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++}>{para.map((p, j) => <Fragment key={j}>{inline(p, `p${k}${j}`)}{j < para.length - 1 ? ' ' : ''}</Fragment>)}</p>);
  }
  return <div className="prose-doc">{blocks}</div>;
}
