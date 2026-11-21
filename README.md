# paperdesk

A PDF page editor that runs entirely in your browser. Your PDF never leaves your device: there is no server and nothing is uploaded.

**Try it: https://arsalaanzaidi.github.io/paperdesk/**

- Reorder, add and delete pages.
- Add text, or edit the text that's already there.
- Export the edited PDF, or a page as a PNG.

## Run it locally

```bash
yarn install
yarn dev     # Vite dev server
yarn test    # unit tests
yarn build   # production build in dist/
```

## How it works

[ARCHITECTURE.md](ARCHITECTURE.md) is an engineering account of the design: the data flow, how text edits are matched to fonts and exported, editor/export parity, performance, testing, deployment, and known limitations.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

paperdesk's code is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md): free for personal, research, educational and other noncommercial use. Commercial use needs permission. The bundled fonts stay under the [SIL Open Font License](public/licenses), and third-party packages keep their own licences.
