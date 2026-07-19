# HushStats for Raycast

An ambient system monitor that stays quiet until there is a reason not to.

One dot in the menu bar. Grey means everything is fine, so it disappears into the bar. When something needs attention the dot changes **colour** to say how bad it is, and **shape** to say what it is: a chip for CPU, a display for GPU, a memory module for RAM, a drive for disk, a battery for power. The only text is the battery time left, because the percentage already lives in the native battery icon.

The drop-down has the numbers, top processes with quit actions, and a picker to change the bar icon to whatever you prefer.

This is the Raycast port of the [SwiftBar plugin](https://github.com/pavmik/swiftbar-plugins).

## What it watches

| subsystem | turns warm when |
|---|---|
| **CPU** | sustained load, or thermal throttling |
| **GPU** | utilization, or thermal throttling |
| **Memory** | usage, or macOS memory pressure |
| **System** | disk filling up, stale backup, high battery drain, low battery |

Thermal throttling is SoC-wide on Apple Silicon, so it colours both compute readings. Swap is shown but never alarms - macOS keeps swap busy even when nothing is wrong, so memory pressure carries that signal instead.

## Colours

A five-step pastel scale, cold to warm, so an alert is soft but unmissable:

slate (idle) → sage (light) → sand (worth a glance) → peach (high) → rose (critical)

Thresholds are tuned per metric, because 80 % memory is normal on macOS while 80 % disk is not.

## No sudo, no daemon

Everything is read without a single password prompt:

- **battery** health, cycle count, temperature and instantaneous draw: `ioreg AppleSmartBattery`
- **GPU** utilization: `ioreg IOAccelerator`
- **memory**: `vm_stat` (`os.freemem()` ignores inactive pages and reads ~99 % used on a healthy Mac)
- **memory pressure**: `sysctl kern.memorystatus_vm_pressure_level`
- **backup age**: real Time Machine destination dates, not local APFS snapshots - those are always fresh and would report a healthy backup that never ran
- **thermal state**: an optional Swift helper around `NSProcessInfo.thermalState`

## Thermal helper (optional)

`pmset -g therm` is Intel-only and always reports nominal on Apple Silicon, so thermal state needs a tiny helper. Without it the thermal row simply hides itself.

```sh
mkdir -p ~/Library/Application\ Support/swiftbar-hushstats
cat > /tmp/thermal.swift <<'EOF'
import Foundation
let names = ["nominal", "fair", "serious", "critical"]
print(names[min(max(ProcessInfo.processInfo.thermalState.rawValue, 0), 3)])
EOF
swiftc -O /tmp/thermal.swift -o ~/Library/Application\ Support/swiftbar-hushstats/thermal-helper
```

The path is shared with the SwiftBar plugin, so if you already run that one, the helper is in place.

## Development

From this folder:

```sh
npm install
npm run dev     # loads into Raycast; run the command once to pin it to the menu bar
```

Menu-bar commands only appear after being launched once from Raycast.

Data collection lives in `src/metrics.ts`, rendering in `src/hushstats.tsx`.

## What it talks to

Everything is read locally except one thing: the public IP row asks `ifconfig.co` over HTTPS, cached for five minutes. That is the extension's only network call - if you would rather it made none, delete the `extIp()` collector and its row.

Nothing is sent anywhere else. Quit and Force quit send a signal to the PID you picked, and nothing else acts on your machine.

## Notes

- The refresh interval is set in `package.json` (`"interval": "10s"`). macOS may shift the actual timing to save energy.
- GPU utilization is sampled first and on its own: the `ioreg` counter covers a very short window since the last read, so a concurrent `ioreg` call zeroes it out.
- The last sample is kept in Raycast's `Cache`, so the menu paints instantly instead of flashing a placeholder on every refresh.

## License

MIT
