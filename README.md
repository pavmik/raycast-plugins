# Raycast extensions

My [Raycast](https://raycast.com) extensions for macOS. One folder per extension, each with its own README.

Everything here is built for Apple Silicon, reads the system without ever asking for a password, and tries to stay quiet until something actually needs attention.

## Extensions

| extension | what it does |
|---|---|
| [**hushstats**](hushstats/) | Ambient system monitor. One dot in the menu bar - colour says how bad it is, icon says what it is. The drop-down carries the detail, top processes with quit actions, and a pick-your-own bar icon. |

## Development

Each extension is a standalone Raycast project. Work inside its folder:

```sh
cd hushstats
npm install
npm run dev     # loads into Raycast in development mode
```

Menu-bar commands only show up after being launched once from Raycast.

## Related

The SwiftBar counterpart of hushstats lives in [pavmik/swiftbar-plugins](https://github.com/pavmik/swiftbar-plugins).

## License

MIT. See [LICENSE](LICENSE).
