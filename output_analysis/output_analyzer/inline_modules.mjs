#!/usr/bin/env node
// Embeds every module under js/ into output_analyzer.html, between the
// OA-MODULES-BEGIN and OA-MODULES-END markers, as inert text blocks that the
// page's own loader turns into modules at run time. The js/ files are the
// source; run this after editing one:
//
//   node output_analysis/output_analyzer/inline_modules.mjs          # rewrite the page
//   node output_analysis/output_analyzer/inline_modules.mjs --check  # exit 1 if the page is stale
//
// test/inline.test.mjs runs the check, so a stale page fails the test suite.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HTML_PATH = path.join(HERE, 'output_analyzer.html');
const BEGIN = '<!-- OA-MODULES-BEGIN -->', END = '<!-- OA-MODULES-END -->';

/** Every .js file under js/, as paths relative to this directory, sorted. */
export function listModules() {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js')) out.push(path.relative(HERE, p).split(path.sep).join('/'));
    }
  })(path.join(HERE, 'js'));
  return out;
}

/** The text blocks for every module, one <script type="text/plain"> each. */
export function buildBlocks() {
  return listModules().map(rel => {
    let text = fs.readFileSync(path.join(HERE, rel), 'utf8');
    // Raw text inside a <script> element ends at the first "</script", and a
    // "<!--" or "<script" inside it changes how the parser looks for that end,
    // so none of the three may appear in a module.
    if (/<\/script|<!--|<script/i.test(text)) throw new Error(rel + ' contains a sequence that cannot sit inside a script element.');
    if (!text.endsWith('\n')) text += '\n';
    return '<script type="text/plain" data-module="' + rel + '">\n' + text + '</script>';
  }).join('\n');
}

/** The page's HTML with the module region replaced by fresh blocks. */
export function inlined(html) {
  const b = html.indexOf(BEGIN), e = html.indexOf(END);
  if (b < 0 || e < 0 || e < b) throw new Error('output_analyzer.html lacks the OA-MODULES markers.');
  return html.slice(0, b + BEGIN.length) + '\n' + buildBlocks() + '\n' + html.slice(e);
}

/** Whether the page on disk already carries the current modules. */
export function isFresh() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  return inlined(html) === html;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    if (isFresh()) { console.log('output_analyzer.html carries the current modules.'); }
    else { console.error('output_analyzer.html is stale: run inline_modules.mjs.'); process.exit(1); }
  } else {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const next = inlined(html);
    fs.writeFileSync(HTML_PATH, next);
    console.log('Embedded ' + listModules().length + ' modules; output_analyzer.html is ' + next.length.toLocaleString('en-US') + ' bytes.');
  }
}
