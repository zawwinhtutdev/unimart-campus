# Contributing

Thanks for taking a look. This is a small study project, so the process is
deliberately light.

## Run it locally

```bash
python3 server.py            # http://127.0.0.1:8000
```

No virtualenv, no `npm install` — the server uses only the Python standard
library and the front end is plain HTML, CSS and JavaScript.

## Before you open a pull request

```bash
python3 -m unittest discover -s tests    # 30 tests, ~4 s
for f in js/*.js js/vendor/*.js admin/*.js; do node --check "$f"; done
```

Then load `/`, `/admin/` and `/checkout.html` once and click through the flow
you touched. If you changed the UI, refresh the relevant screenshots in
`docs/screenshots/`.

## Style

- **Python**: standard library only, 4-space indent, type hints on function
  signatures, no frameworks. Keep SQL parameterised.
- **JavaScript**: classic scripts, no build step, no framework. Prefer small
  functions and comments that explain *why*.
- **CSS**: design tokens live at the top of each stylesheet; components below.
- **Commits**: imperative subject line, then a short paragraph explaining the
  decision and how it was verified.

## What is out of scope

Real payment gateways, email delivery, and multi-instance deployment — this
project intentionally stays runnable from a single `python3` command. See the
"Deliberate limitations" section of the README.
