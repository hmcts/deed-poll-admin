#!/usr/bin/env python3
"""Parses a "Copy as cURL (bash)" preview POST for scripts/rate-limit-observe-check.sh.

Prints curl's argument list, NUL-separated, only if the command is one email-preview POST to AAT's admin and
nothing else; otherwise prints "Refusing: ..." to stderr and exits 3. The script runs that list as an array, so
what was checked is exactly what runs: the old guard checked the first https:// anywhere in the file and then
`eval`ed all of it, so a send with a preview URL in its Referer passed (review finding R16,
docs/plans/completed/20261022-r11-r16-path-segments-and-observe-guard.md).

Options are an allowlist of what browsers write, not a list of dangerous ones, and nothing read from the file is
ever printed: it holds a live session cookie. Run with `python3 -I`.
"""
import re
import sys

PREVIEW_URL = re.compile(
    r"https://deed-poll-admin(-staging)?\.aat\.platform\.hmcts\.net"
    r"/deed-polls/[A-Za-z0-9_-]+/emails/[A-Za-z0-9_-]+/preview"
)
# Characters bash gives no meaning to outside quotes. Anything else unquoted (; | & < > $ ` ( ) * ? [ ] { } ~ # !
# and newline among them) is refused rather than interpreted.
PLAIN = re.compile(r"[A-Za-z0-9_\-./:=,+@%]")
WITH_VALUE = {"-H", "--header", "-b", "--cookie", "-X", "--request", "--url",
              "-d", "--data", "--data-raw", "--data-binary"}
FLAGS = {"--compressed"}
BODY = {"-d", "--data", "--data-raw", "--data-binary"}
# --data-raw is the one body option that does not read a file named after an "@".
READS_AT_FILE = {"-d", "--data", "--data-binary"}
URL_HEADERS = {"referer", "origin"}
# Headers that would route the checked URL to another virtual host behind the same gateway.
ROUTING_HEADERS = re.compile(r"host|forwarded|x-forwarded-.*")
SCHEME = re.compile(rb"[A-Za-z][A-Za-z0-9+.-]*://")
# curl sends a header or cookie value as given, so a CR or LF in one starts another header the name checks never saw.
CONTROL = re.compile(rb"[\x00-\x1f\x7f]")
SIMPLE_ESCAPES = {"a": 7, "b": 8, "e": 27, "E": 27, "f": 12, "n": 10, "r": 13, "t": 9, "v": 11,
                  "\\": 92, "'": 39, '"': 34, "?": 63}


class Refusal(Exception):
    pass


def main():
    if len(sys.argv) != 2:
        print("usage: rate-limit-observe-check-parse.py <copied-curl-file>", file=sys.stderr)
        return 2
    try:
        with open(sys.argv[1], encoding="utf-8") as copied:
            text = copied.read()
        argv = checked(words(text))
    except UnicodeDecodeError:
        return refuse("the file is not UTF-8 text")
    except Refusal as refusal:
        return refuse(str(refusal))
    sys.stdout.buffer.write(b"".join(arg + b"\0" for arg in argv))
    return 0


def refuse(reason):
    print(f"Refusing: {reason}.", file=sys.stderr)
    return 3


def words(text):
    """Splits the text as bash would split one simple command, refusing anything bash would expand or chain."""
    text = text.replace("\r\n", "\n").rstrip()
    out, word, i = [], None, 0
    while i < len(text):
        c = text[i]
        if c == "\\":
            if i + 1 >= len(text):
                raise Refusal("the command ends in a backslash")
            if text[i + 1] != "\n":
                word = (word or b"") + text[i + 1].encode()
            i += 2
        elif c in " \t":
            if word is not None:
                out.append(word)
            word, i = None, i + 1
        elif c == "'":
            end = text.find("'", i + 1)
            if end < 0:
                raise Refusal("a quote is not closed")
            word, i = (word or b"") + text[i + 1:end].encode(), end + 1
        elif c == "$" and text[i + 1:i + 2] == "'":
            decoded, i = ansi_c(text, i + 2)
            word = (word or b"") + decoded
        elif c == '"':
            decoded, i = double_quoted(text, i + 1)
            word = (word or b"") + decoded
        elif PLAIN.fullmatch(c):
            word, i = (word or b"") + c.encode(), i + 1
        else:
            raise Refusal("the command holds shell syntax outside quotes (a second command, a pipe, a redirection, "
                          "an expansion or a line break), so it is not one curl call")
    if word is not None:
        out.append(word)
    if any(b"\0" in arg for arg in out):
        raise Refusal("an argument holds a NUL character")
    return out


def ansi_c(text, i):
    out = bytearray()
    while i < len(text):
        c = text[i]
        if c == "'":
            return bytes(out), i + 1
        if c != "\\":
            out += c.encode()
            i += 1
            continue
        e = text[i + 1:i + 2]
        if e in SIMPLE_ESCAPES:
            out.append(SIMPLE_ESCAPES[e])
            i += 2
        elif e in ("x", "u"):
            digits = re.match(r"[0-9A-Fa-f]{1,%d}" % (2 if e == "x" else 4), text[i + 2:])
            if not digits:
                raise Refusal("a $'...' escape is malformed")
            value = int(digits.group(), 16)
            if 0xD800 <= value <= 0xDFFF:
                raise Refusal("a $'...' escape is malformed")
            out += bytes([value]) if e == "x" else chr(value).encode()
            i += 2 + len(digits.group())
        elif e == "":
            break
        else:
            # Browsers write only the simple escapes, \x and \u; refusing the rest of bash's set (octal, \U, \c)
            # means nothing is decoded differently from how bash would decode it.
            raise Refusal("a $'...' escape is not one a browser writes")
    raise Refusal("a quote is not closed")


def double_quoted(text, i):
    out = bytearray()
    while i < len(text):
        c = text[i]
        if c == '"':
            return bytes(out), i + 1
        if c in "$`":
            raise Refusal("a double-quoted argument holds an expansion")
        if c == "\\" and text[i + 1:i + 2] in ('"', "\\", "$", "`", "\n"):
            if text[i + 1] != "\n":
                out += text[i + 1].encode()
            i += 2
            continue
        out += c.encode()
        i += 1
    raise Refusal("a quote is not closed")


def checked(argv):
    if not argv or argv[0] != b"curl":
        raise Refusal("the command is not a curl call")
    urls, has_body, i = [], False, 1
    while i < len(argv):
        arg = argv[i].decode("utf-8", "replace")
        if not arg.startswith("-"):
            urls.append(argv[i])
            i += 1
            continue
        if arg in FLAGS:
            i += 1
            continue
        if arg not in WITH_VALUE:
            name = arg if re.fullmatch(r"--?[A-Za-z0-9:-]{1,30}", arg) else "an unrecognised option"
            raise Refusal(f"{name} is not something a browser's preview copy holds, and only that is run")
        if i + 1 >= len(argv):
            raise Refusal(f"{arg} has no value")
        value = argv[i + 1]
        check_value(arg, value)
        if arg == "--url":
            urls.append(value)
        has_body = has_body or arg in BODY
        i += 2
    if len(urls) != 1 or not PREVIEW_URL.fullmatch(urls[0].decode("utf-8", "replace")):
        raise Refusal("the copied request must be one preview POST to AAT's admin, ending /emails/<template>/preview")
    if not has_body:
        raise Refusal("the copied request has no form body. Copy the POST, not the page load")
    # --disable must come first: it stops curl reading ~/.curlrc, so nothing but these arguments shapes the request.
    return [b"curl", b"--disable"] + argv[1:]


def check_value(option, value):
    if option in ("-X", "--request") and value != b"POST":
        raise Refusal("the method is not POST")
    if option in ("-H", "--header", "-b", "--cookie") and CONTROL.search(value):
        raise Refusal("a header or cookie holds a control character, such as a line break")
    if option in ("-H", "--header"):
        if value.startswith(b"@"):
            raise Refusal("a header would be read from a file")
        name = value.split(b":", 1)[0].strip().lower().decode("utf-8", "replace")
        if ROUTING_HEADERS.fullmatch(name):
            raise Refusal("a header would change where the request is routed")
        if name in URL_HEADERS:
            return
    if option in ("-b", "--cookie") and b"=" not in value:
        raise Refusal("the cookie would be read from a file")
    if option in READS_AT_FILE and value.startswith(b"@"):
        raise Refusal("the body would be read from a file")
    if option != "--url" and SCHEME.search(value):
        raise Refusal("a URL appears outside the destination and its Referer or Origin header")


if __name__ == "__main__":
    sys.exit(main())
