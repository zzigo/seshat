from __future__ import annotations

import base64
import html
import plistlib
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urljoin, urlparse


VOID_TAGS = {"br", "hr", "img", "meta", "link", "input", "source", "track", "wbr"}
DROP_TAGS = {"script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "embed", "form", "button"}
NOISE_TAGS = {"nav", "aside", "footer"}
SAFE_TAGS = {
    "a", "abbr", "article", "b", "blockquote", "br", "cite", "code", "dd", "del", "details", "dfn", "div", "dl", "dt",
    "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li",
    "main", "mark", "ol", "p", "pre", "q", "s", "samp", "section", "small", "strong", "sub", "summary", "sup",
    "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul", "var",
}
BLOCK_TAGS = {"article", "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure", "li", "main", "p", "pre", "section", "table"}
NEGATIVE_HINT = re.compile(r"\b(ad|advert|banner|breadcrumb|cookie|footer|menu|nav|newsletter|popup|promo|related|share|sidebar|social|sponsor)\b", re.I)


@dataclass
class HtmlNode:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list[HtmlNode | str] = field(default_factory=list)
    parent: HtmlNode | None = None

    def text(self) -> str:
        return "".join(child if isinstance(child, str) else child.text() for child in self.children)

    def descendants(self) -> Iterable[HtmlNode]:
        yield self
        for child in self.children:
            if isinstance(child, HtmlNode):
                yield from child.descendants()


class TreeParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = HtmlNode("document")
        self.stack = [self.root]
        self.drop_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        name = tag.lower()
        if self.drop_depth or name in DROP_TAGS:
            if name not in VOID_TAGS:
                self.drop_depth += 1
            return
        node = HtmlNode(name, {key.lower(): value or "" for key, value in attrs}, parent=self.stack[-1])
        self.stack[-1].children.append(node)
        if name not in VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag.lower() not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        name = tag.lower()
        if self.drop_depth:
            self.drop_depth -= 1
            return
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == name:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        if not self.drop_depth and data:
            self.stack[-1].children.append(data)


def _decode_resource(resource: dict[str, Any]) -> str:
    data = resource.get("WebResourceData", b"")
    if isinstance(data, str):
        return data
    raw = bytes(data)
    declared = str(resource.get("WebResourceTextEncodingName") or "").strip()
    encodings = [declared, "utf-8", "utf-16", "windows-1252", "latin-1"]
    for encoding in dict.fromkeys(item for item in encodings if item):
        try:
            return raw.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", errors="replace")


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def _meta(parser: TreeParser, *names: str) -> str:
    wanted = {name.casefold() for name in names}
    for node in parser.root.descendants():
        if node.tag != "meta":
            continue
        key = (node.attrs.get("property") or node.attrs.get("name") or "").casefold()
        if key in wanted and node.attrs.get("content"):
            return _clean_text(node.attrs["content"])
    return ""


def _first_text(parser: TreeParser, tag: str) -> str:
    return next((_clean_text(node.text()) for node in parser.root.descendants() if node.tag == tag and _clean_text(node.text())), "")


def _candidate_score(node: HtmlNode) -> float:
    text = _clean_text(node.text())
    if len(text) < 120:
        return -1
    links = sum(len(_clean_text(item.text())) for item in node.descendants() if item.tag == "a")
    paragraphs = sum(1 for item in node.descendants() if item.tag == "p" and len(_clean_text(item.text())) >= 35)
    headings = sum(1 for item in node.descendants() if item.tag in {"h1", "h2", "h3"})
    hint = f"{node.attrs.get('id', '')} {node.attrs.get('class', '')}"
    role = node.attrs.get("role", "").casefold()
    bonus = 900 if node.tag == "article" else 650 if node.tag == "main" or role == "main" else 0
    penalty = 1200 if NEGATIVE_HINT.search(hint) or role in {"navigation", "complementary", "banner", "contentinfo"} else 0
    return len(text) + paragraphs * 120 + headings * 80 + bonus - (links / max(1, len(text))) * len(text) * 1.8 - penalty


def _is_noise(node: HtmlNode) -> bool:
    hint = f"{node.attrs.get('id', '')} {node.attrs.get('class', '')}"
    role = node.attrs.get("role", "").casefold()
    return node.tag in NOISE_TAGS or bool(NEGATIVE_HINT.search(hint)) or role in {"navigation", "complementary", "banner", "contentinfo"}


def _remove_duplicate_title(node: HtmlNode, title: str) -> bool:
    for child in list(node.children):
        if not isinstance(child, HtmlNode):
            continue
        if child.tag == "h1" and _clean_text(child.text()).casefold() == _clean_text(title).casefold():
            node.children.remove(child)
            return True
        if _remove_duplicate_title(child, title):
            return True
    return False


def _main_content(parser: TreeParser) -> HtmlNode:
    candidates = [node for node in parser.root.descendants() if node.tag in {"article", "main", "section", "div", "body"}]
    if not candidates:
        return parser.root
    return max(candidates, key=_candidate_score)


def _resource_data(resources: list[dict[str, Any]]) -> dict[str, str]:
    values: dict[str, str] = {}
    total_bytes = 0
    for resource in resources:
        url = str(resource.get("WebResourceURL") or "")
        data = resource.get("WebResourceData")
        mime = str(resource.get("WebResourceMIMEType") or "application/octet-stream").split(";", 1)[0]
        if not url or not isinstance(data, (bytes, bytearray)) or mime not in {"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"}:
            continue
        if len(data) > 16 * 1024 * 1024 or total_bytes + len(data) > 64 * 1024 * 1024:
            continue
        total_bytes += len(data)
        values[url] = f"data:{mime};base64,{base64.b64encode(bytes(data)).decode('ascii')}"
    return values


def _archives(archive: dict[str, Any]) -> Iterable[dict[str, Any]]:
    yield archive
    for frame in archive.get("WebSubframeArchives") or []:
        if isinstance(frame, dict):
            yield from _archives(frame)


def _safe_href(value: str, base_url: str) -> str:
    if value.startswith("#"):
        return value
    resolved = urljoin(base_url, value)
    return resolved if urlparse(resolved).scheme in {"http", "https", "mailto"} else ""


def _serialize(node: HtmlNode | str, base_url: str, resources: dict[str, str]) -> str:
    if isinstance(node, str):
        return html.escape(node)
    if _is_noise(node):
        return ""
    if node.tag not in SAFE_TAGS:
        return "".join(_serialize(child, base_url, resources) for child in node.children)
    attrs: list[str] = []
    if node.tag == "a":
        href = _safe_href(node.attrs.get("href", ""), base_url)
        if href:
            attrs.extend([f'href="{html.escape(href, quote=True)}"', 'target="_blank"', 'rel="noreferrer noopener"'])
    elif node.tag == "img":
        raw = node.attrs.get("src", "")
        resolved = urljoin(base_url, raw)
        source = resources.get(raw) or resources.get(resolved) or (raw if raw.startswith("data:image/") else "")
        if not source:
            return ""
        attrs.append(f'src="{html.escape(source, quote=True)}"')
        if node.attrs.get("alt"):
            attrs.append(f'alt="{html.escape(_clean_text(node.attrs["alt"]), quote=True)}"')
        attrs.append('loading="lazy"')
    elif node.tag == "time" and node.attrs.get("datetime"):
        attrs.append(f'datetime="{html.escape(node.attrs["datetime"], quote=True)}"')
    children = "".join(_serialize(child, base_url, resources) for child in node.children)
    attributes = f" {' '.join(attrs)}" if attrs else ""
    return f"<{node.tag}{attributes}>" if node.tag in VOID_TAGS else f"<{node.tag}{attributes}>{children}</{node.tag}>"


def _markdown(node: HtmlNode | str, base_url: str, depth: int = 0) -> str:
    if isinstance(node, str):
        return re.sub(r"\s+", " ", html.unescape(node))
    if _is_noise(node):
        return ""
    body = "".join(_markdown(child, base_url, depth + 1) for child in node.children)
    text = body.strip()
    if not text and node.tag != "img":
        return ""
    if node.tag in {f"h{level}" for level in range(1, 7)}:
        return f"\n\n{'#' * int(node.tag[1])} {text}\n\n"
    if node.tag == "p":
        return f"\n\n{text}\n\n"
    if node.tag == "blockquote":
        return "\n\n" + "\n".join(f"> {line}" for line in text.splitlines()) + "\n\n"
    if node.tag == "li":
        return f"\n- {text}"
    if node.tag in {"ul", "ol"}:
        return f"\n{body.strip()}\n"
    if node.tag in {"strong", "b"}:
        return f"**{text}**"
    if node.tag in {"em", "i", "cite"}:
        return f"*{text}*"
    if node.tag == "code" and node.parent and node.parent.tag != "pre":
        return f"`{text}`"
    if node.tag == "pre":
        return f"\n\n```\n{text}\n```\n\n"
    if node.tag == "a":
        href = _safe_href(node.attrs.get("href", ""), base_url)
        return f"[{text}]({href})" if href else text
    if node.tag == "img":
        return f"\n\n![{_clean_text(node.attrs.get('alt', ''))}]\n\n"
    if node.tag == "br":
        return "\n"
    if node.tag in BLOCK_TAGS:
        return f"\n\n{text}\n\n"
    return body


def extract_webarchive(path: Path) -> dict[str, Any]:
    with path.open("rb") as stream:
        archive = plistlib.load(stream)
    if not isinstance(archive, dict):
        raise ValueError("The WebArchive is not a property-list dictionary.")
    containers = list(_archives(archive))
    mains = [item.get("WebMainResource") for item in containers if isinstance(item.get("WebMainResource"), dict)]
    if not mains:
        raise ValueError("The WebArchive has no main resource.")
    parsed_candidates: list[tuple[float, dict[str, Any], TreeParser, HtmlNode]] = []
    for main in mains:
        if "html" not in str(main.get("WebResourceMIMEType") or "").casefold():
            continue
        candidate_parser = TreeParser()
        candidate_parser.feed(_decode_resource(main))
        candidate_content = _main_content(candidate_parser)
        parsed_candidates.append((_candidate_score(candidate_content), main, candidate_parser, candidate_content))
    if not parsed_candidates:
        raise ValueError("The WebArchive contains no readable HTML resource.")
    _, main, parser, selected = max(parsed_candidates, key=lambda item: item[0])
    source_url = str(main.get("WebResourceURL") or "")
    title = _meta(parser, "og:title", "twitter:title") or _first_text(parser, "h1") or _first_text(parser, "title") or path.stem
    author = _meta(parser, "author", "article:author", "parsely-author", "byl")
    published = _meta(parser, "article:published_time", "date", "datepublished", "publishdate")
    site = _meta(parser, "og:site_name", "application-name") or urlparse(source_url).hostname or ""
    resources = _resource_data([
        resource for container in containers for resource in (container.get("WebSubresources") or [])
        if isinstance(resource, dict)
    ])
    _remove_duplicate_title(selected, title)
    content_html = _serialize(selected, source_url, resources)
    source_link = f'<a href="{html.escape(source_url, quote=True)}" target="_blank" rel="noreferrer noopener">{html.escape(site or source_url)}</a>' if source_url else html.escape(site)
    details = " · ".join(html.escape(value) for value in (author, published) if value)
    header = f'<header><p>{source_link}</p><h1>{html.escape(title)}</h1>{f"<p>{details}</p>" if details else ""}</header>'
    document_html = f'<!doctype html><html><head><meta charset="utf-8"><title>{html.escape(title)}</title></head><body><article>{header}{content_html}</article></body></html>'
    markdown_body = re.sub(r"\n{3,}", "\n\n", _markdown(selected, source_url)).strip()
    front = [f"# {title}"]
    if author:
        front.append(f"Author: {author}")
    if published:
        front.append(f"Published: {published}")
    if source_url:
        front.append(f"Source: {source_url}")
    markdown = "\n\n".join(front + [markdown_body]).strip() + "\n"
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", markdown_body) if len(_clean_text(part)) >= 2]
    return {
        "html": document_html,
        "markdown": markdown,
        "metadata": {"title": title, "author": author, "published": published, "site": site, "url": source_url},
        "chunks": [{"id": index, "text": _clean_text(part), "metadata": {"source": source_url}} for index, part in enumerate(paragraphs)],
    }
