# Screenshots

Drop README hero assets in this folder. The READMEs reference:

- `widget-preview.png` — the OpenWind passage widget rendered inline in an
  MCP client (Claude Desktop, Le Chat, …). Used as the hero image in the
  root README, the HF Space README, and the Starlette landing of the Space.
  Replace by a `widget-preview.gif` (animated demo) later — update the
  `<img src="…">` in [packages/hf-space/app.py](../../packages/hf-space/app.py)
  and the markdown references in the two READMEs.

Both READMEs and the Starlette landing reference the file via the GitHub raw
URL on `main` so the image resolves on huggingface.co and from the live HF
Space without extra plumbing.
