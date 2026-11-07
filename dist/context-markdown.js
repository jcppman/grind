import { marked } from 'marked';
import { decodeHTML } from 'entities';
import GithubSlugger from 'github-slugger';
import path from 'node:path';
function inlineText(tokens) {
    return tokens.map(token => {
        if (token.type === 'html')
            return '';
        if ('tokens' in token && token.tokens)
            return inlineText(token.tokens);
        if (token.type === 'codespan')
            return token.text;
        return decodeHTML('text' in token ? token.text : token.raw);
    }).join('');
}
function headings(body) {
    const normalized = body.replace(/\r\n?/g, '\n');
    const offsets = [];
    for (let i = 0; i < body.length; i++) {
        offsets.push(i);
        if (body[i] === '\r' && body[i + 1] === '\n')
            i++;
    }
    offsets.push(body.length);
    const tokens = marked.lexer(normalized);
    const slugger = new GithubSlugger();
    const slugs = new Map();
    marked.walkTokens(tokens, token => {
        if (token.type === 'heading')
            slugs.set(token, slugger.slug(inlineText(token.tokens ?? [])));
    });
    const result = [];
    let offset = 0;
    for (const token of tokens) {
        if (token.type === 'heading') {
            const text = inlineText(token.tokens ?? []);
            result.push({ slug: slugs.get(token), text, depth: token.depth, start: offsets[offset], end: body.length });
        }
        offset += token.raw.length;
    }
    for (let i = 0; i < result.length; i++) {
        const heading = result[i];
        heading.end = result.slice(i + 1).find(next => next.depth <= heading.depth)?.start ?? body.length;
    }
    return result;
}
export function markdownSection(body, fragment) {
    const heading = headings(body).find(entry => entry.slug === fragment);
    if (!heading)
        throw new Error(`Required fragment #${fragment} does not exist`);
    return body.slice(heading.start, heading.end);
}
export function requiredLinks(body) {
    const tokens = marked.lexer(body);
    const sections = tokens.flatMap((token, index) => token.type === 'heading' && token.depth === 2 && inlineText(token.tokens ?? []) === 'Read on every context load' ? [index] : []);
    if (sections.length > 1)
        throw new Error('Multiple Read on every context load sections are ambiguous');
    if (!sections.length)
        return [];
    const afterHeading = tokens.slice(sections[0] + 1);
    const nextHeading = afterHeading.findIndex(token => token.type === 'heading' && token.depth <= 2);
    const section = nextHeading < 0 ? afterHeading : afterHeading.slice(0, nextHeading);
    const links = [];
    for (const token of section) {
        if (token.type === 'heading' || token.type === 'space' || token.type === 'def')
            continue;
        if (token.type !== 'list')
            throw new Error('Required reads must be Markdown links in list items');
        for (const item of token.items) {
            const found = [];
            marked.walkTokens(item.tokens, child => { if (child.type === 'link')
                found.push(child.href); });
            if (found.length === 0)
                throw new Error('Required read list item has no supported Markdown link');
            links.push(...found);
        }
    }
    return links;
}
export function resolveLink(href, source) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
        return { path: href, fragment: null, external: true };
    }
    const hash = href.indexOf('#');
    const file = hash < 0 ? href : href.slice(0, hash);
    return {
        path: file ? path.resolve(path.dirname(source), decodeURIComponent(file)) : source,
        fragment: hash < 0 ? null : decodeURIComponent(href.slice(hash + 1)),
        external: false,
    };
}
export function navigation(body, source) {
    const links = [];
    marked.walkTokens(marked.lexer(body), token => {
        if (token.type === 'link')
            links.push({ label: inlineText(token.tokens ?? []), ...resolveLink(token.href, source) });
    });
    return links;
}
//# sourceMappingURL=context-markdown.js.map