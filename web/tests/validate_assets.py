"""Offline format gate for every bundled binary/vector asset (Python stdlib only)."""

from __future__ import annotations

import hashlib
import json
import struct
import sys
import tempfile
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

SVG = "http://www.w3.org/2000/svg"


def validate(path: Path) -> dict:
    data = path.read_bytes()
    assert data, f"{path.name}: empty asset"
    info = {
        "path": str(path.name),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    if path.suffix == ".svg":
        assert b"<!DOCTYPE" not in data.upper() and b"<!ENTITY" not in data.upper(), (
            "External XML declarations"
        )
        root = ET.fromstring(data)
        assert root.tag == f"{{{SVG}}}svg", "Expected SVG XML root, not HTML"
        width, height = float(root.attrib["width"]), float(root.attrib["height"])
        assert width > 0 and height > 0, "Invalid SVG dimensions"
        box = [float(n) for n in root.attrib["viewBox"].split()]
        assert len(box) == 4 and box[2] > 0 and box[3] > 0, "Invalid SVG viewBox"
        painted = False
        for node in root.iter():
            tag = node.tag.rsplit("}", 1)[-1]
            assert tag not in {"script", "iframe", "image"}, (
                "Unexpected embedded content"
            )
            painted |= tag in {
                "path",
                "circle",
                "rect",
                "line",
                "polyline",
                "polygon",
                "ellipse",
                "text",
            }
            for name, value in node.attrib.items():
                assert not name.lower().startswith("on"), "SVG event handler"
                if name.rsplit("}", 1)[-1] == "href":
                    assert value.startswith("#"), "External SVG reference"
                assert "javascript:" not in value.lower(), "Executable SVG attribute"
                if "url(" in value.lower():
                    import re

                    assert all(
                        u.strip(" \"' ").startswith("#")
                        for u in re.findall(r"url\((.*?)\)", value, re.I)
                    ), "External SVG paint"
        assert painted, "SVG has no drawable content"
        info.update(mime="image/svg+xml", width=width, height=height)
    elif path.suffix == ".png":
        assert data[:8] == b"\x89PNG\r\n\x1a\n", "Invalid PNG signature"
        offset, chunks = 8, []
        while offset < len(data):
            assert offset + 12 <= len(data), "Truncated PNG chunk"
            size = struct.unpack_from(">I", data, offset)[0]
            end = offset + 12 + size
            assert end <= len(data), "Truncated PNG data"
            tag, body = (
                data[offset + 4 : offset + 8],
                data[offset + 8 : offset + 8 + size],
            )
            crc = struct.unpack_from(">I", data, offset + 8 + size)[0]
            assert zlib.crc32(tag + body) & 0xFFFFFFFF == crc, "PNG CRC mismatch"
            chunks.append(tag)
            if tag == b"IHDR":
                width, height = struct.unpack_from(">II", body)
                assert width > 0 and height > 0
            offset = end
        assert chunks[0] == b"IHDR" and chunks[-1] == b"IEND" and b"IDAT" in chunks
        info.update(mime="image/png", width=width, height=height)
    elif path.suffix == ".ttf":
        assert data[:4] == b"\x00\x01\x00\x00", "Invalid TrueType SFNT signature"
        count = struct.unpack_from(">H", data, 4)[0]
        assert 0 < count <= 128 and 12 + 16 * count <= len(data), (
            "Invalid font directory"
        )
        tables = {}
        for n in range(count):
            tag, checksum, offset, length = struct.unpack_from(
                ">4sIII", data, 12 + n * 16
            )
            assert offset >= 12 + 16 * count and offset + length <= len(data), (
                "Font table outside file"
            )
            assert tag not in tables, "Duplicate font table"
            tables[tag] = (offset, length)
        assert {
            b"head",
            b"hhea",
            b"maxp",
            b"cmap",
            b"name",
            b"hmtx",
            b"glyf",
            b"loca",
        } <= tables.keys()
        head, length = tables[b"head"]
        assert (
            length >= 54 and struct.unpack_from(">I", data, head + 12)[0] == 0x5F0F3CF5
        ), "Invalid font head"
        info.update(mime="font/ttf", tables=count)
    else:
        raise AssertionError(f"Unexpected asset format: {path.name}")
    return info


def self_test() -> None:
    bad = [
        ("html.svg", b"<html><body>Site Unavailable</body></html>"),
        (
            "broken.svg",
            b'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path></svg>',
        ),
        (
            "empty.svg",
            b'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"/>',
        ),
        ("fake.png", b"<html>not a png</html>"),
        ("fake.ttf", b"<html>not a font</html>"),
        ("truncated.ttf", b"\x00\x01\x00\x00\x00\x01"),
    ]
    with tempfile.TemporaryDirectory() as folder:
        for name, content in bad:
            path = Path(folder) / name
            path.write_bytes(content)
            try:
                validate(path)
            except (AssertionError, ET.ParseError, KeyError, ValueError, struct.error):
                pass
            else:
                raise AssertionError(f"Validator accepted {name}")
    print(json.dumps({"rejected_invalid_fixtures": len(bad)}))


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        root = Path(__file__).resolve().parents[1] / "public" / "acenta"
        assets = sorted(
            p for p in root.rglob("*") if p.suffix in {".svg", ".png", ".ttf"}
        )
        assert assets, "No assets found"
        result = [dict(validate(p), path=str(p.relative_to(root))) for p in assets]
        print(json.dumps(result, indent=2))
